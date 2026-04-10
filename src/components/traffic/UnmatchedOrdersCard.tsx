import React, { useState, useMemo } from "react";
import { AlertTriangle, ArrowUpDown, ChevronDown, ExternalLink } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const fmtC = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtN = (v: number) => v.toLocaleString("en-US");

type SortKey = "order_id" | "order_type" | "source" | "marketer" | "total_spent" | "status";
type SortDir = "asc" | "desc";

interface Order {
  id: string;
  order_id: string | null;
  order_type: string | null;
  source: string | null;
  marketer: string | null;
  campaign_url: string | null;
  total_spent: number | null;
  status: string | null;
}

export function UnmatchedOrdersCard() {
  const [expanded, setExpanded] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("total_spent");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["unmatched_orders_list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("onlytraffic_unmatched_orders")
        .select("id, order_id, order_type, source, marketer, campaign_url, total_spent, status")
        .order("total_spent", { ascending: false });
      if (error) throw error;
      return (data || []) as Order[];
    },
  });

  const types = useMemo(() => {
    const s = new Set<string>();
    orders.forEach(o => { if (o.order_type) s.add(o.order_type); });
    return Array.from(s).sort();
  }, [orders]);

  const sources = useMemo(() => {
    const s = new Set<string>();
    orders.forEach(o => { if (o.source) s.add(o.source); });
    return Array.from(s).sort();
  }, [orders]);

  const filtered = useMemo(() => {
    let list = orders;
    if (typeFilter !== "all") list = list.filter(o => o.order_type === typeFilter);
    if (sourceFilter !== "all") list = list.filter(o => o.source === sourceFilter);
    return list;
  }, [orders, typeFilter, sourceFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === "number" ? av - (bv as number) : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  const totalSpend = filtered.reduce((s, o) => s + Number(o.total_spent || 0), 0);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  const displayed = expanded ? sorted : sorted.slice(0, 10);

  const statusColor = (s: string | null) => {
    if (!s) return {};
    if (s === "completed") return { backgroundColor: "hsl(142 71% 45% / 0.15)", color: "hsl(142 71% 45%)" };
    if (s === "active") return { backgroundColor: "hsl(174 60% 51% / 0.15)", color: "hsl(174 60% 51%)" };
    if (s === "accepted") return { backgroundColor: "hsl(217 91% 60% / 0.15)", color: "hsl(217 91% 60%)" };
    if (s === "waiting") return { backgroundColor: "hsl(38 92% 50% / 0.15)", color: "hsl(38 92% 50%)" };
    if (s === "rejected") return { backgroundColor: "hsl(0 84% 60% / 0.15)", color: "hsl(0 84% 60%)" };
    if (s === "cancelled") return { backgroundColor: "hsl(220 9% 46% / 0.2)", color: "hsl(220 9% 46%)" };
    return { backgroundColor: "hsl(220 9% 46% / 0.15)", color: "hsl(220 9% 46%)" };
  };

  const typeBadge = (t: string | null) => {
    if (t === "CPL") return { backgroundColor: "#0891b2", color: "#fff" };
    if (t === "CPC") return { backgroundColor: "#d97706", color: "#fff" };
    return { backgroundColor: "hsl(220 9% 46% / 0.2)", color: "hsl(220 9% 46%)" };
  };

  const ColHeader = ({ label, col }: { label: string; col: SortKey }) => (
    <th
      className="text-left cursor-pointer select-none hover:text-foreground transition-colors"
      style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", padding: "6px 8px" }}
      onClick={() => handleSort(col)}
    >
      <span className="flex items-center gap-1">
        {label}
        {sortKey === col && <ArrowUpDown className="h-3 w-3" />}
      </span>
    </th>
  );

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" style={{ color: "#d97706" }} />
          <span className="text-foreground font-bold text-base">Unmatched Orders</span>
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ backgroundColor: "hsl(38 92% 50% / 0.15)", color: "#d97706" }}>
            {fmtN(orders.length)}
          </span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-7 w-[110px] text-xs">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {types.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="h-7 w-[130px] text-xs">
            <SelectValue placeholder="All Sources" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            {sources.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-6 text-muted-foreground text-xs">Loading…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full" style={{ fontSize: "12px" }}>
            <thead>
              <tr className="text-muted-foreground border-b border-border">
                <ColHeader label="Order ID" col="order_id" />
                <ColHeader label="Type" col="order_type" />
                <ColHeader label="Source" col="source" />
                <ColHeader label="Marketer" col="marketer" />
                <th className="text-left" style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", padding: "6px 8px" }}>URL</th>
                <ColHeader label="Spend" col="total_spent" />
                <ColHeader label="Status" col="status" />
              </tr>
            </thead>
            <tbody>
              {displayed.map(o => (
                <tr key={o.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer">
                  <td className="py-2 px-2 font-mono text-foreground" style={{ fontSize: "11px" }}>{o.order_id || "—"}</td>
                  <td className="py-2 px-2">
                    {o.order_type ? (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={typeBadge(o.order_type)}>{o.order_type}</span>
                    ) : "—"}
                  </td>
                  <td className="py-2 px-2 text-foreground" style={{ fontSize: "11px" }}>{o.source || "—"}</td>
                  <td className="py-2 px-2 text-foreground" style={{ fontSize: "11px" }}>{o.marketer || "—"}</td>
                  <td className="py-2 px-2 max-w-[180px] truncate" style={{ fontSize: "11px" }}>
                    {o.campaign_url ? (
                      <a href={o.campaign_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                        <span className="truncate">{o.campaign_url.replace(/^https?:\/\//, "").slice(0, 30)}</span>
                      </a>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="py-2 px-2 font-mono font-semibold text-foreground" style={{ fontSize: "11px" }}>{fmtC(Number(o.total_spent || 0))}</td>
                  <td className="py-2 px-2">
                    {o.status ? (
                      <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold" style={statusColor(o.status)}>{o.status}</span>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Show more / less */}
      {sorted.length > 10 && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="flex items-center gap-1 text-primary font-semibold hover:underline mx-auto"
          style={{ fontSize: "12px" }}
        >
          {expanded ? "Show Less" : `View Full List (${fmtN(sorted.length)})`}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      )}

      {/* Summary row */}
      <div className="flex items-center justify-between pt-3 border-t border-border">
        <span className="font-semibold" style={{ fontSize: "11px", color: "#d97706" }}>Total Unmatched</span>
        <span className="font-mono font-bold" style={{ fontSize: "13px", color: "#d97706" }}>
          {fmtN(filtered.length)} orders · {fmtC(totalSpend)}
        </span>
      </div>
    </div>
  );
}
