import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCrossPollDetail } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ModelAvatar } from "@/components/ModelAvatar";
import { ChevronDown, ChevronUp } from "lucide-react";

const fmtC = (v: number | null) =>
  v == null ? "—" : "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type CpSortKey = "sourceCampaign" | "sourceModel" | "fanId" | "destModel" | "revenue";

interface Props {
  accounts: any[];
  accountLookup: Record<string, any>;
  linkLookup: Record<string, any>;
  globalModelFilter: string[];
}

export function CrossPollDetailTable({ accounts, globalModelFilter }: Props) {
  const [sourceFilter, setSourceFilter] = useState("all");
  const [destFilter,   setDestFilter]   = useState("all");
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
        {sortKey === k
          ? (sortAsc ? <ChevronUp className="h-3 w-3 text-primary" /> : <ChevronDown className="h-3 w-3 text-primary" />)
          : <ChevronDown className="h-3 w-3 opacity-30" />}
      </span>
    </TableHead>
  );

  const effectiveSource = globalModelFilter.length === 1 ? globalModelFilter[0]
    : sourceFilter !== "all" ? sourceFilter : undefined;

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["crosspoll_detail", effectiveSource, destFilter],
    queryFn: () => getCrossPollDetail({
      limit: 500,
      source_account_id: effectiveSource,
      dest_account_id: destFilter !== "all" ? destFilter : undefined,
    }),
    staleTime: 120_000,
  });

  const sorted = [...rows].sort((a, b) => {
    const dir = sortAsc ? 1 : -1;
    switch (sortKey) {
      case "sourceCampaign": return dir * (a.campaign_name ?? "").localeCompare(b.campaign_name ?? "");
      case "sourceModel":    return dir * (a.source_account_name ?? "").localeCompare(b.source_account_name ?? "");
      case "fanId":          return dir * (a.fan_id ?? "").localeCompare(b.fan_id ?? "");
      case "destModel":      return dir * (a.dest_account_name ?? "").localeCompare(b.dest_account_name ?? "");
      case "revenue":        return dir * (Number(a.revenue || 0) - Number(b.revenue || 0));
      default:               return 0;
    }
  });

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
              <SortHead label="Source Model"    k="sourceModel" />
              <SortHead label="Fan"             k="fanId" />
              <SortHead label="Received By"     k="destModel" />
              <SortHead label="Revenue"         k="revenue" align="right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
            ) : sorted.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No cross-poll transactions found</TableCell></TableRow>
            ) : sorted.slice(0, 200).map((r: any, i: number) => {
              const srcAcc = accounts.find((a: any) => String(a.id).toLowerCase() === String(r.source_account_id).toLowerCase());
              const dstAcc = accounts.find((a: any) => String(a.id).toLowerCase() === String(r.dest_account_id).toLowerCase());
              return (
                <TableRow key={`${r.fan_id}-${r.source_account_id}-${r.dest_account_id}-${i}`} className="border-border">
                  <TableCell className="text-foreground max-w-[180px]">
                    <div className="truncate">{r.campaign_name || "—"}</div>
                    {r.campaign_url && (
                      <a href={r.campaign_url} target="_blank" rel="noopener noreferrer"
                         className="text-xs text-primary hover:underline truncate block max-w-[180px]">
                        {r.campaign_url}
                      </a>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <ModelAvatar avatarUrl={srcAcc?.avatar_thumb_url} name={r.source_account_name} size={24} />
                      <span className="text-muted-foreground text-sm">{r.source_account_name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-foreground">
                    {r.username || (r.fan_id?.length > 12 ? r.fan_id.slice(0, 12) + "…" : r.fan_id)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <ModelAvatar avatarUrl={dstAcc?.avatar_thumb_url} name={r.dest_account_name} size={24} />
                      <span className="text-muted-foreground text-sm">{r.dest_account_name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-medium text-primary">{fmtC(Number(r.revenue || 0))}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {sorted.length >= 200 && (
          <div className="text-center text-xs text-muted-foreground py-3">Showing first 200 rows</div>
        )}
      </CardContent>
    </Card>
  );
}
