import React, { useState, useMemo } from "react";
import { CampaignDetailDrawer } from "@/components/dashboard/CampaignDetailDrawer";
import { ArrowLeft, DollarSign, TrendingUp, BarChart3, Users, Percent, ChevronUp, ChevronDown } from "lucide-react";
import { differenceInDays } from "date-fns";
import { ModelAvatar } from "@/components/ModelAvatar";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const fmtC = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtN = (v: number) => v.toLocaleString("en-US");
const fmtPct = (v: number) => `${v.toFixed(1)}%`;

function getStatusBadge(link: any): { label: string; bg: string; text: string } {
  const spend = Number(link.cost_total || 0);
  if (spend <= 0) return { label: "NO SPEND", bg: "hsl(220 9% 46% / 0.15)", text: "hsl(220 9% 46%)" };
  const revenue = Number(link.revenue || 0);
  const roi = (revenue - spend) / spend * 100;
  if (roi > 150) return { label: "SCALE", bg: "hsl(142 71% 45% / 0.15)", text: "hsl(142 71% 45%)" };
  if (roi >= 50) return { label: "WATCH", bg: "hsl(199 89% 48% / 0.15)", text: "hsl(199 89% 48%)" };
  if (roi >= 0) return { label: "LOW", bg: "hsl(38 92% 50% / 0.15)", text: "hsl(38 92% 50%)" };
  return { label: "KILL", bg: "hsl(0 84% 60% / 0.15)", text: "hsl(0 84% 60%)" };
}

type SortKey = "campaign" | "model" | "marketer" | "clicks" | "subs" | "revenue" | "spend" | "profit" | "roi" | "profitSub" | "status" | "source";

interface Props {
  sourceName: string;
  sourceColor: string;
  categoryName: string;
  links: any[];
  onBack: () => void;
  sourceTagOptions: string[];
  onTagLink: (linkId: string, sourceTag: string) => void;
}

const PAGE_SIZE = 25;

export function TrafficSourceDetail({ sourceName, sourceColor, categoryName, links, onBack, sourceTagOptions, onTagLink }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(0);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [drawerCampaign, setDrawerCampaign] = useState<any>(null);

  const isUntaggedView = sourceName === "Untagged";

  // KPIs
  const kpis = useMemo(() => {
    const spend = links.filter(l => Number(l.cost_total || 0) > 0).reduce((s, l) => s + Number(l.cost_total || 0), 0);
    const revenue = links.reduce((s, l) => s + Number(l.revenue || 0), 0);
    const profit = revenue - spend;
    const subs = links.reduce((s, l) => s + (l.subscribers || 0), 0);
    const roi = spend > 0 ? (profit / spend) * 100 : null;
    const cplLinks = links.filter(l => l.payment_type === "CPL" && Number(l.cost_total || 0) > 0);
    const cplSpend = cplLinks.reduce((s, l) => s + Number(l.cost_total || 0), 0);
    const cplSubs = cplLinks.reduce((s, l) => s + (l.subscribers || 0), 0);
    const avgCpl = cplSubs > 0 ? cplSpend / cplSubs : null;
    const profitPerSub = subs > 0 ? profit / subs : null;
    const ages = links.map(l => Math.max(1, differenceInDays(new Date(), new Date(l.created_at))));
    const avgAge = ages.length > 0 ? ages.reduce((a, b) => a + b, 0) / ages.length : 1;
    const subsDay = avgAge > 0 ? subs / avgAge : 0;
    return { spend, revenue, profit, avgCpl, profitPerSub, subsDay, roi };
  }, [links]);

  // Sorting
  const sorted = useMemo(() => {
    const getValue = (l: any): number | string => {
      const spend = Number(l.cost_total || 0);
      const rev = Number(l.revenue || 0);
      const profit = spend > 0 ? rev - spend : -Infinity;
      const roi = spend > 0 ? (rev - spend) / spend * 100 : -Infinity;
      const subs = l.subscribers || 0;
      const profitSub = spend > 0 && subs > 0 ? (rev - spend) / subs : -Infinity;
      switch (sortKey) {
        case "campaign": return (l.campaign_name || "").toLowerCase();
        case "model": return (l.accounts?.username || "").toLowerCase();
        case "marketer": return (l.onlytraffic_marketer || "").toLowerCase();
        case "clicks": return l.clicks || 0;
        case "subs": return subs;
        case "revenue": return rev;
        case "spend": return spend;
        case "profit": return profit;
        case "roi": return roi;
        case "profitSub": return profitSub;
        case "status": return spend <= 0 ? -2 : roi;
        case "source": return (l.source_tag || "").toLowerCase();
        default: return 0;
      }
    };
    return [...links].sort((a, b) => {
      const va = getValue(a);
      const vb = getValue(b);
      if (typeof va === "string" && typeof vb === "string") return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortAsc ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
  }, [links, sortKey, sortAsc]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
    setPage(0);
  };

  const handleAssignSource = async (linkId: string, tag: string) => {
    const actualTag = tag === "__add_manual__" ? "Manual" : tag;
    setSavingIds(prev => new Set(prev).add(linkId));
    try {
      const { error } = await supabase
        .from("tracking_links")
        .update({ source_tag: actualTag, traffic_category: "Manual", manually_tagged: true })
        .eq("id", linkId);
      if (error) throw error;
      onTagLink(linkId, actualTag);
      toast.success(`Tagged as "${actualTag}"`);
    } catch (e: any) {
      toast.error("Failed to tag: " + (e.message || "Unknown error"));
    } finally {
      setSavingIds(prev => { const n = new Set(prev); n.delete(linkId); return n; });
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return null;
    return sortAsc ? <ChevronUp className="h-3 w-3 inline ml-0.5" /> : <ChevronDown className="h-3 w-3 inline ml-0.5" />;
  };

  const thClass = "cursor-pointer select-none whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors";

  return (
    <div className="space-y-4">
      {/* Back */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
        style={{ fontSize: "13px", fontWeight: 500 }}
      >
        <ArrowLeft className="h-4 w-4" /> Back to {categoryName}
      </button>

      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: sourceColor }} />
        <span className="text-foreground font-bold text-lg">{sourceName}</span>
        <span className="text-muted-foreground" style={{ fontSize: "12px" }}>{links.length} campaigns</span>
      </div>

      {/* Sub-KPI row */}
      <div className="grid grid-cols-7 gap-3">
        <SubKpi icon={<DollarSign className="h-3.5 w-3.5" />} label="Spend" value={fmtC(kpis.spend)} color="#dc2626" />
        <SubKpi icon={<TrendingUp className="h-3.5 w-3.5" />} label="Revenue" value={fmtC(kpis.revenue)} color="#16a34a" />
        <SubKpi icon={<TrendingUp className="h-3.5 w-3.5" />} label="Profit" value={fmtC(kpis.profit)} color={kpis.profit >= 0 ? "#16a34a" : "#dc2626"} />
        <SubKpi icon={<DollarSign className="h-3.5 w-3.5" />} label="Avg CPL" value={kpis.avgCpl !== null ? fmtC(kpis.avgCpl) : "—"} color="#0891b2" />
        <SubKpi icon={<Users className="h-3.5 w-3.5" />} label="Profit/Sub" value={kpis.profitPerSub !== null ? fmtC(kpis.profitPerSub) : "—"} color="#7c3aed" />
        <SubKpi icon={<BarChart3 className="h-3.5 w-3.5" />} label="Subs/Day" value={kpis.subsDay > 0 ? kpis.subsDay.toFixed(1) : "0"} color="#d97706" />
        <SubKpi icon={<Percent className="h-3.5 w-3.5" />} label="ROI" value={kpis.roi !== null ? fmtPct(kpis.roi) : "—"} color={kpis.roi !== null ? (kpis.roi >= 0 ? "#16a34a" : "#dc2626") : "#64748b"} />
      </div>

      {/* Campaign table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border">
              <TableHead className={thClass} onClick={() => handleSort("campaign")}>Campaign <SortIcon col="campaign" /></TableHead>
              <TableHead className={thClass} onClick={() => handleSort("model")}>Model <SortIcon col="model" /></TableHead>
              <TableHead className={thClass} onClick={() => handleSort("marketer")}>Marketer <SortIcon col="marketer" /></TableHead>
              {isUntaggedView && (
                <TableHead className={`${thClass}`} onClick={() => handleSort("source")}>Source <SortIcon col="source" /></TableHead>
              )}
              <TableHead className={`${thClass} text-right`} onClick={() => handleSort("clicks")}>Clicks <SortIcon col="clicks" /></TableHead>
              <TableHead className={`${thClass} text-right`} onClick={() => handleSort("subs")}>Subs <SortIcon col="subs" /></TableHead>
              <TableHead className={`${thClass} text-right`} onClick={() => handleSort("revenue")}>Revenue <SortIcon col="revenue" /></TableHead>
              <TableHead className={`${thClass} text-right`} onClick={() => handleSort("spend")}>Spend <SortIcon col="spend" /></TableHead>
              <TableHead className={`${thClass} text-right`} onClick={() => handleSort("profit")}>Profit <SortIcon col="profit" /></TableHead>
              <TableHead className={`${thClass} text-right`} onClick={() => handleSort("roi")}>ROI <SortIcon col="roi" /></TableHead>
              <TableHead className={`${thClass} text-right`} onClick={() => handleSort("profitSub")}>Profit/Sub <SortIcon col="profitSub" /></TableHead>
              <TableHead className={`${thClass} text-center`} onClick={() => handleSort("status")}>Status <SortIcon col="status" /></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map(link => {
              const spend = Number(link.cost_total || 0);
              const rev = Number(link.revenue || 0);
              const profit = spend > 0 ? rev - spend : null;
              const roi = spend > 0 ? ((rev - spend) / spend) * 100 : null;
              const subs = link.subscribers || 0;
              const profitSub = spend > 0 && subs > 0 ? (rev - spend) / subs : null;
              const badge = getStatusBadge(link);
              const username = link.accounts?.username || null;
              const displayName = link.accounts?.display_name || username || "Unknown";
              const avatarUrl = link.accounts?.avatar_thumb_url || null;
              const profitColor = profit !== null ? (profit >= 0 ? "hsl(142 71% 45%)" : "hsl(0 84% 60%)") : undefined;
              const roiColor = roi !== null ? (roi >= 0 ? "hsl(142 71% 45%)" : "hsl(0 84% 60%)") : undefined;
              const isSaving = savingIds.has(link.id);

              return (
                <TableRow key={link.id} className="border-border">
                  <TableCell className="max-w-[220px]">
                    <p className="text-foreground font-semibold truncate" style={{ fontSize: "12px" }}>{link.campaign_name || "—"}</p>
                    <p className="text-muted-foreground truncate" style={{ fontSize: "10px" }}>{link.url}</p>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <ModelAvatar avatarUrl={avatarUrl} name={displayName} size={20} />
                      <span className="text-foreground" style={{ fontSize: "12px" }}>@{username || "unknown"}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-foreground" style={{ fontSize: "12px" }}>{link.onlytraffic_marketer || "—"}</span>
                  </TableCell>
                  {isUntaggedView && (
                    <TableCell>
                      {!link.source_tag ? (
                        <Select
                          disabled={isSaving}
                          onValueChange={(val) => handleAssignSource(link.id, val)}
                        >
                          <SelectTrigger className="h-7 w-[130px] text-[11px] border-border bg-background">
                            <SelectValue placeholder={isSaving ? "Saving…" : "Assign source"} />
                          </SelectTrigger>
                          <SelectContent>
                            {sourceTagOptions.map(tag => (
                              <SelectItem key={tag} value={tag} className="text-[11px]">{tag}</SelectItem>
                            ))}
                            <SelectItem value="__add_manual__" className="text-[11px] text-blue-500 font-semibold">
                              + Add to Manual
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-foreground" style={{ fontSize: "12px" }}>{link.source_tag}</span>
                      )}
                    </TableCell>
                  )}
                  <TableCell className="text-right font-mono" style={{ fontSize: "12px" }}>{fmtN(link.clicks || 0)}</TableCell>
                  <TableCell className="text-right font-mono" style={{ fontSize: "12px" }}>{fmtN(subs)}</TableCell>
                  <TableCell className="text-right font-mono" style={{ fontSize: "12px", color: "hsl(173 80% 36%)" }}>{fmtC(rev)}</TableCell>
                  <TableCell className="text-right font-mono" style={{ fontSize: "12px" }}>{fmtC(spend)}</TableCell>
                  <TableCell className="text-right font-mono" style={{ fontSize: "12px", color: profitColor }}>{profit !== null ? fmtC(profit) : "—"}</TableCell>
                  <TableCell className="text-right font-mono" style={{ fontSize: "12px", color: roiColor }}>{roi !== null ? fmtPct(roi) : "—"}</TableCell>
                  <TableCell className="text-right font-mono" style={{ fontSize: "12px", color: profitColor }}>{profitSub !== null ? fmtC(profitSub) : "—"}</TableCell>
                  <TableCell className="text-center">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ backgroundColor: badge.bg, color: badge.text }}>
                      {badge.label}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
            {pageRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={isUntaggedView ? 12 : 11} className="text-center py-8 text-muted-foreground" style={{ fontSize: "13px" }}>
                  No campaigns found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <span className="text-muted-foreground" style={{ fontSize: "12px" }}>
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sorted.length)} of {sorted.length}
            </span>
            <div className="flex items-center gap-1">
              <button
                disabled={page === 0}
                onClick={() => setPage(p => p - 1)}
                className="px-2 py-1 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <span className="text-foreground font-mono" style={{ fontSize: "12px" }}>{page + 1} / {totalPages}</span>
              <button
                disabled={page >= totalPages - 1}
                onClick={() => setPage(p => p + 1)}
                className="px-2 py-1 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
              >
                <ArrowLeft className="h-4 w-4 rotate-180" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SubKpi({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="bg-card border border-border px-3 py-2.5 rounded-xl" style={{ borderLeft: `3px solid ${color}` }}>
      <div className="flex items-center gap-1.5 mb-0.5">
        <span style={{ color }}>{icon}</span>
        <span className="text-muted-foreground" style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
      </div>
      <p className="font-mono font-bold text-foreground" style={{ fontSize: "16px" }}>{value}</p>
    </div>
  );
}
