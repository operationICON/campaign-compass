import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ModelAvatar } from "@/components/ModelAvatar";
import { ChevronDown, ChevronUp } from "lucide-react";

const fmtC = (v: number | null) =>
  v == null ? "—" : "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type CpSortKey = "sourceCampaign" | "sourceModel" | "fanId" | "spentOnModel" | "spentOnCampaign" | "revenue";

interface Props {
  accounts: any[];
  accountLookup: Record<string, any>;
  linkLookup: Record<string, any>;
  globalModelFilter: string;
}

export function CrossPollDetailTable({ accounts, accountLookup, linkLookup, globalModelFilter }: Props) {
  const [sourceFilter, setSourceFilter] = useState("all");
  const [destFilter, setDestFilter] = useState("all");
  const [sortKey, setSortKey] = useState<CpSortKey>("revenue");
  const [sortAsc, setSortAsc] = useState(false);
  const handleSort = (k: CpSortKey) => {
    if (k === sortKey) setSortAsc(!sortAsc);
    else { setSortKey(k); setSortAsc(false); }
  };
  const SortHead = ({ label, k, align = "left" }: { label: string; k: CpSortKey; align?: "left" | "right" }) => (
    <TableHead
      className={`text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors ${align === "right" ? "text-right" : ""}`}
      onClick={() => handleSort(k)}
    >
      <span className={`inline-flex items-center gap-1 ${align === "right" ? "justify-end" : ""}`}>
        {label}
        {sortKey === k ? (
          sortAsc ? <ChevronUp className="h-3 w-3 text-primary" /> : <ChevronDown className="h-3 w-3 text-primary" />
        ) : <ChevronDown className="h-3 w-3 opacity-30" />}
      </span>
    </TableHead>
  );

  // Fetch fan_spenders with revenue
  const { data: spenders = [], isLoading } = useQuery({
    queryKey: ["crosspoll_detail_spenders"],
    queryFn: async () => {
      const all: any[] = [];
      let from = 0;
      const batchSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("fan_spenders")
          .select("fan_id, tracking_link_id, account_id, revenue_total")
          .range(from, from + batchSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < batchSize) break;
        from += batchSize;
      }
      return all;
    },
  });

  // Fetch new fans lookup
  const { data: newFans = [] } = useQuery({
    queryKey: ["crosspoll_new_fans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fans")
        .select("fan_id")
        .eq("is_new_fan", true);
      if (error) throw error;
      return data;
    },
  });

  const newFanSet = useMemo(() => new Set(newFans.map((f: any) => f.fan_id)), [newFans]);

  // Build cross-poll detail rows
  const detailRows = useMemo(() => {
    // Group by fan_id
    const byFan: Record<string, any[]> = {};
    spenders.forEach((s: any) => {
      if (!byFan[s.fan_id]) byFan[s.fan_id] = [];
      byFan[s.fan_id].push(s);
    });

    const rows: any[] = [];
    Object.entries(byFan).forEach(([fanId, entries]) => {
      if (!newFanSet.has(fanId)) return;
      const uniqueAccounts = new Set(entries.map((e: any) => e.account_id));
      if (uniqueAccounts.size < 2) return;

      // For each pair where accounts differ
      for (let i = 0; i < entries.length; i++) {
        for (let j = 0; j < entries.length; j++) {
          if (i === j) continue;
          const src = entries[i];
          const dest = entries[j];
          if (String(src.account_id).toLowerCase() === String(dest.account_id).toLowerCase()) continue;

          const srcLink = linkLookup[String(src.tracking_link_id ?? "").toLowerCase()];
          const destLink = linkLookup[String(dest.tracking_link_id ?? "").toLowerCase()];
          const srcAcc = accountLookup[String(src.account_id ?? "").toLowerCase()];
          const destAcc = accountLookup[String(dest.account_id ?? "").toLowerCase()];

          rows.push({
            fanId: fanId,
            sourceCampaign: srcLink?.campaign_name || src.tracking_link_id || "—",
            sourceModel: srcAcc?.display_name || src.account_id || "—",
            sourceAvatarUrl: srcAcc?.avatar_thumb_url,
            sourceAccountId: src.account_id,
            spentOnModel: destAcc?.display_name || dest.account_id || "—",
            destAvatarUrl: destAcc?.avatar_thumb_url,
            destAccountId: dest.account_id,
            spentOnCampaign: destLink?.campaign_name || dest.tracking_link_id || "—",
            revenue: Number(dest.revenue_total || 0),
          });
        }
      }
    });

    // Deduplicate: unique by fanId + sourceAccountId + destAccountId
    const seen = new Set<string>();
    const deduped = rows.filter(r => {
      const key = `${r.fanId}-${r.sourceAccountId}-${r.destAccountId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort by revenue desc
    deduped.sort((a, b) => b.revenue - a.revenue);
    return deduped;
  }, [spenders, newFanSet, linkLookup, accountLookup]);

  // Apply filters + sort
  const filteredRows = useMemo(() => {
    let rows = detailRows;
    if (globalModelFilter !== "all") {
      rows = rows.filter(r => r.sourceAccountId === globalModelFilter);
    }
    if (sourceFilter !== "all") {
      rows = rows.filter(r => r.sourceAccountId === sourceFilter);
    }
    if (destFilter !== "all") {
      rows = rows.filter(r => r.destAccountId === destFilter);
    }
    const dir = sortAsc ? 1 : -1;
    const sorted = [...rows].sort((a, b) => {
      const va = a[sortKey], vb = b[sortKey];
      if (typeof va === "string" && typeof vb === "string") return dir * va.localeCompare(vb);
      return dir * ((Number(va) || 0) - (Number(vb) || 0));
    });
    return sorted.slice(0, 200);
  }, [detailRows, globalModelFilter, sourceFilter, destFilter, sortKey, sortAsc]);

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <CardTitle className="text-sm font-semibold text-foreground">Cross-Poll Revenue Detail</CardTitle>
          <div className="flex items-center gap-2">
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="w-[160px] h-8 text-xs bg-card border-border">
                <SelectValue placeholder="Source Model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                {accounts.map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>{a.display_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={destFilter} onValueChange={setDestFilter}>
              <SelectTrigger className="w-[160px] h-8 text-xs bg-card border-border">
                <SelectValue placeholder="Received By" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Receivers</SelectItem>
                {accounts.map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>{a.display_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="border-border">
              <SortHead label="Source Campaign" k="sourceCampaign" />
              <SortHead label="Source Model" k="sourceModel" />
              <SortHead label="Fan ID" k="fanId" />
              <SortHead label="Spent On Model" k="spentOnModel" />
              <SortHead label="Spent On Campaign" k="spentOnCampaign" />
              <SortHead label="Revenue" k="revenue" align="right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
            ) : filteredRows.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No cross-poll transactions found</TableCell></TableRow>
            ) : filteredRows.map((r: any, i: number) => (
              <TableRow key={`${r.fanId}-${r.sourceAccountId}-${r.destAccountId}-${i}`} className="border-border">
                <TableCell className="text-foreground max-w-[180px] truncate">{r.sourceCampaign}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <ModelAvatar avatarUrl={r.sourceAvatarUrl} name={r.sourceModel} size={24} />
                    <span className="text-muted-foreground text-sm">{r.sourceModel}</span>
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs text-foreground">{r.fanId.length > 12 ? r.fanId.slice(0, 12) + "…" : r.fanId}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <ModelAvatar avatarUrl={r.destAvatarUrl} name={r.spentOnModel} size={24} />
                    <span className="text-muted-foreground text-sm">{r.spentOnModel}</span>
                  </div>
                </TableCell>
                <TableCell className="text-foreground max-w-[180px] truncate">{r.spentOnCampaign}</TableCell>
                <TableCell className="text-right font-medium text-primary">{fmtC(r.revenue)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {filteredRows.length >= 200 && (
          <div className="text-center text-xs text-muted-foreground py-3">Showing first 200 rows</div>
        )}
      </CardContent>
    </Card>
  );
}
