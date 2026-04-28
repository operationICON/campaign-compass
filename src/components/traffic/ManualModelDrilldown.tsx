import React, { useState, useMemo } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, ChevronUp } from "lucide-react";
import { ModelAvatar } from "@/components/ModelAvatar";
import { CampaignDetailDrawer } from "@/components/dashboard/CampaignDetailDrawer";
import { LinkActivityFilter, type LinkActivityFilterValue } from "@/components/LinkActivityFilter";
import { getActiveInfo } from "@/hooks/useActiveLinkStatus";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const fmtC = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtN = (v: number) => v.toLocaleString("en-US");
const fmtPct = (v: number) => `${v.toFixed(1)}%`;
const profitColor = (v: number) => v >= 0 ? "hsl(142 71% 45%)" : "hsl(0 84% 60%)";

type SortKey = "model" | "campaigns" | "subs" | "clicks" | "spend" | "revenue" | "profit" | "ltv" | "cpl" | "cvr" | "roi";

function SortIcon({ active, asc }: { active: boolean; asc: boolean }) {
  if (!active) return <ChevronDown className="h-3 w-3 inline ml-0.5 opacity-20" />;
  return asc ? <ChevronUp className="h-3 w-3 inline ml-0.5 text-primary" /> : <ChevronDown className="h-3 w-3 inline ml-0.5 text-primary" />;
}

function StatItem({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col items-start py-1" style={{ flex: "1 1 0", minWidth: 0 }}>
      <span className="text-muted-foreground uppercase tracking-wider" style={{ fontSize: "10px" }}>{label}</span>
      <span className="font-mono" style={{ fontSize: "18px", fontWeight: 500, color: color || "hsl(var(--foreground))" }}>{value}</span>
    </div>
  );
}

function StatDivider() {
  return <div className="w-px h-8 bg-border shrink-0" />;
}

interface Props {
  links: any[];
  groupTitle: string;
  onBack: () => void;
  activeLookup: Map<string, any>;
}

export function ManualModelDrilldown({ links, groupTitle, onBack, activeLookup }: Props) {
  const [expandedModel, setExpandedModel] = useState<string | null>(null);
  const [profitableFilter, setProfitableFilter] = useState(false);
  const [losingFilter, setLosingFilter] = useState(false);
  const [scaleFilter, setScaleFilter] = useState(false);
  const [highVolFilter, setHighVolFilter] = useState(false);
  const [activityFilter, setActivityFilter] = useState<LinkActivityFilterValue>("all");
  const [selectedCampaign, setSelectedCampaign] = useState<any | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("profit");
  const [sortAsc, setSortAsc] = useState(false);

  const modelRows = useMemo(() => {
    const groups: Record<string, any[]> = {};
    for (const link of links) {
      const accountId = link.account_id || "__unknown__";
      if (!groups[accountId]) groups[accountId] = [];
      groups[accountId].push(link);
    }
    return Object.entries(groups).map(([accountId, accLinks]) => {
      const first = accLinks[0];
      const username = first.account_username || first.accounts?.username || null;
      const displayName = first.account_display_name || first.accounts?.display_name || username || "Unknown";
      const avatarUrl = first.account_avatar_thumb_url || first.accounts?.avatar_thumb_url || null;
      const campaigns = accLinks.length;
      const subs = accLinks.reduce((s, l) => s + (l.subscribers || 0), 0);
      const clicks = accLinks.reduce((s, l) => s + (l.clicks || 0), 0);
      const spend = accLinks.reduce((s, l) => s + Number(l.cost_total || 0), 0);
      const revenue = accLinks.reduce((s, l) => s + Number(l.revenue || 0), 0);
      const profit = revenue - spend;
      const ltv = subs > 0 ? revenue / subs : null;
      const cpl = spend > 0 && subs > 0 ? spend / subs : null;
      const cvr = clicks > 0 ? (subs / clicks) * 100 : null;
      const roi = spend > 0 ? (profit / spend) * 100 : null;
      return { accountId, username, displayName, avatarUrl, campaigns, subs, clicks, spend, revenue, profit, ltv, cpl, cvr, roi, links: accLinks };
    });
  }, [links]);

  const isModelActive = (accountId: string) => {
    const row = modelRows.find(r => r.accountId === accountId);
    return (row?.links || []).some((l: any) => getActiveInfo(l.id, activeLookup).isActive);
  };

  const activityCounts = useMemo(() => {
    let base = modelRows;
    if (profitableFilter) base = base.filter(r => r.profit > 0);
    if (losingFilter) base = base.filter(r => r.profit < 0);
    if (scaleFilter) base = base.filter(r => r.profit > 0 && r.roi !== null && r.roi > 50);
    if (highVolFilter) base = base.filter(r => r.campaigns > 10);
    let active = 0;
    for (const r of base) if (isModelActive(r.accountId)) active++;
    return { total: base.length, active };
  }, [modelRows, profitableFilter, losingFilter, scaleFilter, highVolFilter, activeLookup]);

  const filtered = useMemo(() => {
    let rows = modelRows;
    if (profitableFilter) rows = rows.filter(r => r.profit > 0);
    if (losingFilter) rows = rows.filter(r => r.profit < 0);
    if (scaleFilter) rows = rows.filter(r => r.profit > 0 && r.roi !== null && r.roi > 50);
    if (highVolFilter) rows = rows.filter(r => r.campaigns > 10);
    if (activityFilter === "active") rows = rows.filter(r => isModelActive(r.accountId));
    else if (activityFilter === "inactive") rows = rows.filter(r => !isModelActive(r.accountId));
    return rows;
  }, [modelRows, profitableFilter, losingFilter, scaleFilter, highVolFilter, activityFilter, activeLookup]);

  const sorted = useMemo(() => {
    const dir = sortAsc ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "model": return dir * (a.username || a.displayName || "").localeCompare(b.username || b.displayName || "");
        case "campaigns": return dir * (a.campaigns - b.campaigns);
        case "subs": return dir * (a.subs - b.subs);
        case "clicks": return dir * (a.clicks - b.clicks);
        case "spend": return dir * (a.spend - b.spend);
        case "revenue": return dir * (a.revenue - b.revenue);
        case "profit": return dir * (a.profit - b.profit);
        case "ltv": return dir * ((a.ltv ?? -Infinity) - (b.ltv ?? -Infinity));
        case "cpl": return dir * ((a.cpl ?? -Infinity) - (b.cpl ?? -Infinity));
        case "cvr": return dir * ((a.cvr ?? -Infinity) - (b.cvr ?? -Infinity));
        case "roi": return dir * ((a.roi ?? -Infinity) - (b.roi ?? -Infinity));
        default: return 0;
      }
    });
  }, [filtered, sortKey, sortAsc]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const expandedRow = expandedModel ? modelRows.find(r => r.accountId === expandedModel) : null;

  const agencyTotals = useMemo(() => {
    const spend = modelRows.reduce((s, r) => s + r.spend, 0);
    const revenue = modelRows.reduce((s, r) => s + r.revenue, 0);
    const profit = revenue - spend;
    const subs = modelRows.reduce((s, r) => s + r.subs, 0);
    const clicks = modelRows.reduce((s, r) => s + r.clicks, 0);
    return {
      spend, revenue, profit, subs, clicks,
      ltv: subs > 0 ? revenue / subs : null,
      cpl: spend > 0 && subs > 0 ? spend / subs : null,
      cvr: clicks > 0 ? (subs / clicks) * 100 : null,
      roi: spend > 0 ? (profit / spend) * 100 : null,
    };
  }, [modelRows]);

  const stats = expandedRow
    ? { spend: expandedRow.spend, revenue: expandedRow.revenue, profit: expandedRow.profit, subs: expandedRow.subs, clicks: expandedRow.clicks, ltv: expandedRow.ltv, cpl: expandedRow.cpl, cvr: expandedRow.cvr, roi: expandedRow.roi, campaigns: expandedRow.campaigns }
    : { ...agencyTotals, campaigns: modelRows.reduce((s, r) => s + r.campaigns, 0) };

  const profitSub = stats.subs > 0 ? stats.profit / stats.subs : null;
  const statsLabel = expandedRow ? `STATS · @${expandedRow.username || expandedRow.displayName}` : "STATS · AGENCY-WIDE";

  const chipClass = (active: boolean) =>
    `px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${active ? "bg-primary/10 border-primary/40 text-primary" : "border-border text-foreground hover:border-primary/30"}`;

  const thClass = "cursor-pointer select-none whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors";

  return (
    <div className="space-y-5">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
        style={{ fontSize: "13px", fontWeight: 500 }}
      >
        <ArrowLeft className="h-4 w-4" /> Back to Manual
      </button>

      <div>
        <h1 className="text-foreground font-medium" style={{ fontSize: "22px" }}>{groupTitle}</h1>
        <p className="text-muted-foreground" style={{ fontSize: "12px", marginTop: "2px" }}>
          · {fmtN(links.length)} campaigns · {fmtN(modelRows.length)} models
        </p>
      </div>

      {/* Stats bar */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-2">
        <span className="text-muted-foreground uppercase tracking-widest" style={{ fontSize: "12px", fontWeight: 500, letterSpacing: "0.08em" }}>{statsLabel}</span>
        <div className="flex items-center gap-3">
          <StatItem label="Total Spend" value={fmtC(stats.spend)} />
          <StatDivider />
          <StatItem label="Total Revenue" value={fmtC(stats.revenue)} color="hsl(var(--primary))" />
          <StatDivider />
          <StatItem label="Total Profit" value={stats.profit >= 0 ? `+${fmtC(stats.profit)}` : fmtC(stats.profit)} color={profitColor(stats.profit)} />
          <StatDivider />
          <StatItem label="ROI" value={stats.roi !== null ? fmtPct(stats.roi) : "—"} color={stats.roi !== null ? profitColor(stats.roi) : undefined} />
          <StatDivider />
          <StatItem label="Campaigns" value={fmtN(stats.campaigns)} />
        </div>
        <div className="flex items-center gap-3">
          <StatItem label="Subs" value={fmtN(stats.subs)} />
          <StatDivider />
          <StatItem label="Clicks" value={fmtN(stats.clicks)} />
          <StatDivider />
          <StatItem label="Avg CPL" value={stats.cpl !== null ? fmtC(stats.cpl) : "—"} />
          <StatDivider />
          <StatItem label="Avg LTV/Sub" value={stats.ltv !== null ? fmtC(stats.ltv) : "—"} />
          <StatDivider />
          <div className="flex gap-3" style={{ flex: "1 1 0", minWidth: 0 }}>
            <StatItem label="Profit/Sub" value={profitSub !== null ? fmtC(profitSub) : "—"} color={profitSub !== null ? profitColor(profitSub) : undefined} />
            <StatDivider />
            <StatItem label="Avg CVR" value={stats.cvr !== null ? fmtPct(stats.cvr) : "—"} />
          </div>
        </div>
      </div>

      {/* Filter chips + activity tabs */}
      <div className="flex gap-3 items-center flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={() => setProfitableFilter(!profitableFilter)} className={chipClass(profitableFilter)}>Profitable</button>
          <button onClick={() => setLosingFilter(!losingFilter)} className={chipClass(losingFilter)}>Losing money</button>
          <button onClick={() => setScaleFilter(!scaleFilter)} className={chipClass(scaleFilter)}>Scale candidates</button>
          <button onClick={() => setHighVolFilter(!highVolFilter)} className={chipClass(highVolFilter)}>High Volume Orders</button>
        </div>
        <LinkActivityFilter
          value={activityFilter}
          onChange={setActivityFilter}
          totalCount={activityCounts.total}
          activeCount={activityCounts.active}
          className="ml-auto"
        />
      </div>

      {/* Model table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "18%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "7%" }} />
          </colgroup>
          <TableHeader>
            <TableRow className="border-border">
              <TableHead className={thClass} onClick={() => handleSort("model")}>Model <SortIcon active={sortKey === "model"} asc={sortAsc} /></TableHead>
              <TableHead className={`${thClass} text-right`} onClick={() => handleSort("campaigns")}>Campaigns <SortIcon active={sortKey === "campaigns"} asc={sortAsc} /></TableHead>
              <TableHead className={`${thClass} text-right`} onClick={() => handleSort("subs")}>Subs <SortIcon active={sortKey === "subs"} asc={sortAsc} /></TableHead>
              <TableHead className={`${thClass} text-right`} onClick={() => handleSort("clicks")}>Clicks <SortIcon active={sortKey === "clicks"} asc={sortAsc} /></TableHead>
              <TableHead className={`${thClass} text-right`} onClick={() => handleSort("spend")}>Spend <SortIcon active={sortKey === "spend"} asc={sortAsc} /></TableHead>
              <TableHead className={`${thClass} text-right`} onClick={() => handleSort("revenue")}>Revenue <SortIcon active={sortKey === "revenue"} asc={sortAsc} /></TableHead>
              <TableHead className={`${thClass} text-right`} onClick={() => handleSort("profit")}>Profit <SortIcon active={sortKey === "profit"} asc={sortAsc} /></TableHead>
              <TableHead className={`${thClass} text-right`} onClick={() => handleSort("ltv")}>LTV <SortIcon active={sortKey === "ltv"} asc={sortAsc} /></TableHead>
              <TableHead className={`${thClass} text-right`} onClick={() => handleSort("cpl")}>CPL <SortIcon active={sortKey === "cpl"} asc={sortAsc} /></TableHead>
              <TableHead className={`${thClass} text-right`} onClick={() => handleSort("cvr")}>CVR <SortIcon active={sortKey === "cvr"} asc={sortAsc} /></TableHead>
              <TableHead className={`${thClass} text-right`} onClick={() => handleSort("roi")}>ROI <SortIcon active={sortKey === "roi"} asc={sortAsc} /></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((row, i) => {
              const isExpanded = expandedModel === row.accountId;
              const pColor = profitColor(row.profit);
              const roiColor = row.roi !== null ? profitColor(row.roi) : undefined;
              const rowBg = i % 2 === 1 ? "bg-muted/30" : "";

              const campaignRows = row.links.map((link: any) => {
                const sp = Number(link.cost_total || 0);
                const rv = Number(link.revenue || 0);
                const s = link.subscribers || 0;
                const cl = link.clicks || 0;
                const profit = rv - sp;
                const ltv = s > 0 ? rv / s : null;
                const cpl = sp > 0 && s > 0 ? sp / s : null;
                const cvr = cl > 0 ? (s / cl) * 100 : null;
                const roi = sp > 0 ? (profit / sp) * 100 : null;
                return { link, sp, rv, s, cl, profit, ltv, cpl, cvr, roi };
              }).sort((a: any, b: any) => new Date(b.link.created_at).getTime() - new Date(a.link.created_at).getTime());

              return (
                <React.Fragment key={row.accountId}>
                  <TableRow
                    className={`border-border cursor-pointer hover:bg-muted/50 transition-colors ${rowBg} ${isExpanded ? "bg-muted/40" : ""}`}
                    style={{ borderLeft: `3px solid ${isExpanded ? "hsl(var(--primary))" : "transparent"}` }}
                    onMouseEnter={e => { if (!isExpanded) (e.currentTarget as HTMLElement).style.borderLeftColor = "hsl(var(--primary))"; }}
                    onMouseLeave={e => { if (!isExpanded) (e.currentTarget as HTMLElement).style.borderLeftColor = "transparent"; }}
                    onClick={() => setExpandedModel(isExpanded ? null : row.accountId)}
                  >
                    <TableCell className="min-w-[180px]">
                      <div className="flex items-center gap-2">
                        <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                        <ModelAvatar avatarUrl={row.avatarUrl} name={row.username || row.displayName} size={28} />
                        <div>
                          <p className="text-foreground font-semibold" style={{ fontSize: "13px" }}>{row.username ? `@${row.username}` : row.displayName}</p>
                          {row.username && row.displayName !== row.username && (
                            <p className="text-muted-foreground" style={{ fontSize: "11px" }}>{row.displayName}</p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-foreground" style={{ fontSize: "13px" }}>{fmtN(row.campaigns)}</TableCell>
                    <TableCell className="text-right font-mono" style={{ fontSize: "13px" }}>{fmtN(row.subs)}</TableCell>
                    <TableCell className="text-right font-mono" style={{ fontSize: "13px" }}>{fmtN(row.clicks)}</TableCell>
                    <TableCell className="text-right font-mono" style={{ fontSize: "13px" }}>{fmtC(row.spend)}</TableCell>
                    <TableCell className="text-right font-mono" style={{ fontSize: "13px" }}>{fmtC(row.revenue)}</TableCell>
                    <TableCell className="text-right font-mono" style={{ fontSize: "13px", color: pColor }}>{row.profit >= 0 ? `+${fmtC(row.profit)}` : fmtC(row.profit)}</TableCell>
                    <TableCell className="text-right font-mono" style={{ fontSize: "13px" }}>{row.ltv !== null ? fmtC(row.ltv) : "—"}</TableCell>
                    <TableCell className="text-right font-mono" style={{ fontSize: "13px" }}>{row.cpl !== null ? fmtC(row.cpl) : "—"}</TableCell>
                    <TableCell className="text-right font-mono" style={{ fontSize: "13px" }}>{row.cvr !== null ? fmtPct(row.cvr) : "—"}</TableCell>
                    <TableCell className="text-right font-mono" style={{ fontSize: "13px", color: roiColor }}>{row.roi !== null ? fmtPct(row.roi) : "—"}</TableCell>
                  </TableRow>

                  {isExpanded && (
                    <TableRow className="border-border">
                      <TableCell colSpan={11} className="p-0">
                        <div className="bg-background/50 border-t border-border">
                          <table className="w-full table-fixed text-sm">
                            <colgroup>
                              <col style={{ width: "18%" }} />
                              <col style={{ width: "8%" }} />
                              <col style={{ width: "7%" }} />
                              <col style={{ width: "10%" }} />
                              <col style={{ width: "11%" }} />
                              <col style={{ width: "10%" }} />
                              <col style={{ width: "8%" }} />
                              <col style={{ width: "7%" }} />
                              <col style={{ width: "7%" }} />
                              <col style={{ width: "7%" }} />
                              <col style={{ width: "7%" }} />
                            </colgroup>
                            <thead>
                              <tr className="border-b border-border">
                                <th className="text-[8px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap text-left py-1.5 pl-12 pr-2">Campaigns ({campaignRows.length})</th>
                                <th className="text-[8px] font-semibold uppercase tracking-wider text-muted-foreground text-right whitespace-nowrap py-1.5 px-2">Subs</th>
                                <th className="text-[8px] font-semibold uppercase tracking-wider text-muted-foreground text-right whitespace-nowrap py-1.5 px-2">Clicks</th>
                                <th className="text-[8px] font-semibold uppercase tracking-wider text-muted-foreground text-right whitespace-nowrap py-1.5 px-2">Spend</th>
                                <th className="text-[8px] font-semibold uppercase tracking-wider text-muted-foreground text-right whitespace-nowrap py-1.5 px-2">Revenue</th>
                                <th className="text-[8px] font-semibold uppercase tracking-wider text-muted-foreground text-right whitespace-nowrap py-1.5 px-2">Profit</th>
                                <th className="text-[8px] font-semibold uppercase tracking-wider text-muted-foreground text-right whitespace-nowrap py-1.5 px-2">Fan Rev</th>
                                <th className="text-[8px] font-semibold uppercase tracking-wider text-muted-foreground text-right whitespace-nowrap py-1.5 px-2">CPL</th>
                                <th className="text-[8px] font-semibold uppercase tracking-wider text-muted-foreground text-right whitespace-nowrap py-1.5 px-2">CVR</th>
                                <th className="text-[8px] font-semibold uppercase tracking-wider text-muted-foreground text-right whitespace-nowrap py-1.5 px-2">ROI</th>
                                <th />
                              </tr>
                            </thead>
                            <tbody>
                              {campaignRows.map(({ link, sp, rv, s, cl, profit, ltv, cpl, cvr, roi }: any) => {
                                const cProfitColor = profitColor(profit);
                                const cRoiColor = roi !== null ? profitColor(roi) : undefined;
                                return (
                                  <tr
                                    key={link.id}
                                    className="border-b border-border cursor-pointer hover:bg-muted/40 transition-colors"
                                    style={{ borderLeft: "3px solid transparent", height: "38px" }}
                                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderLeftColor = "hsl(var(--primary))"; }}
                                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderLeftColor = "transparent"; }}
                                    onClick={e => { e.stopPropagation(); setSelectedCampaign(link); }}
                                  >
                                    <td className="pl-12 pr-2 py-1 overflow-hidden">
                                      <p className="text-foreground font-semibold truncate" style={{ fontSize: "12px" }}>{link.campaign_name || "Unnamed"}</p>
                                      <p className="text-muted-foreground truncate" style={{ fontSize: "10px" }}>{link.url}</p>
                                    </td>
                                    <td className="text-right font-mono px-2" style={{ fontSize: "11px" }}>{fmtN(s)}</td>
                                    <td className="text-right font-mono px-2" style={{ fontSize: "11px" }}>{fmtN(cl)}</td>
                                    <td className="text-right font-mono px-2" style={{ fontSize: "11px" }}>{fmtC(sp)}</td>
                                    <td className="text-right font-mono px-2" style={{ fontSize: "11px", color: "hsl(var(--primary))" }}>{fmtC(rv)}</td>
                                    <td className="text-right font-mono px-2" style={{ fontSize: "11px", color: cProfitColor }}>{profit >= 0 ? `+${fmtC(profit)}` : fmtC(profit)}</td>
                                    <td className="text-right font-mono px-2" style={{ fontSize: "11px" }}>{ltv !== null ? fmtC(ltv) : "—"}</td>
                                    <td className="text-right font-mono px-2" style={{ fontSize: "11px" }}>{cpl !== null ? fmtC(cpl) : "—"}</td>
                                    <td className="text-right font-mono px-2" style={{ fontSize: "11px" }}>{cvr !== null ? fmtPct(cvr) : "—"}</td>
                                    <td className="text-right font-mono px-2" style={{ fontSize: "11px", color: cRoiColor }}>{roi !== null ? fmtPct(roi) : "—"}</td>
                                    <td />
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              );
            })}
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="text-center py-12 text-muted-foreground" style={{ fontSize: "13px" }}>
                  No models match your filters
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </table>

        {sorted.length > 0 && (
          <div className="px-4 py-3 border-t border-border">
            <span className="text-muted-foreground" style={{ fontSize: "12px" }}>
              Showing {sorted.length} of {modelRows.length} models · Click any row to expand campaigns · Click a campaign to open full details
            </span>
          </div>
        )}
      </div>

      <CampaignDetailDrawer campaign={selectedCampaign} onClose={() => setSelectedCampaign(null)} />
    </div>
  );
}
