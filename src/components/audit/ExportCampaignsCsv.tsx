import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { differenceInDays, format } from "date-fns";

interface Props {
  trackingLinks: any[];
  accounts: any[];
}

export function exportCampaignsCsv(trackingLinks: any[], accounts: any[]) {
  const usernameMap: Record<string, string> = {};
  accounts.forEach((a: any) => { usernameMap[a.id] = a.username || a.display_name; });

  const now = new Date();

  const active = trackingLinks
    .filter((l: any) => !l.deleted_at)
    .map((l: any) => {
      const ageDays = differenceInDays(now, new Date(l.created_at));
      const daysSinceActivity = l.calculated_at ? differenceInDays(now, new Date(l.calculated_at)) : null;
      const clicks = l.clicks || 0;
      const subs = l.subscribers || 0;
      const costTotal = l.cost_total || 0;
      const ltv = l.ltv || l.revenue || 0;
      const profit = costTotal > 0 ? ltv - costTotal : null;
      const roi = costTotal > 0 && profit !== null ? (profit / costTotal) * 100 : null;
      const profitPerSub = costTotal > 0 && subs > 0 && profit !== null ? profit / subs : null;
      const cvr = clicks > 0 ? (subs / clicks) * 100 : 0;
      const subsPerDay = ageDays > 0 ? subs / ageDays : subs;

      // Pre-fill action
      let action = "keep";
      if (clicks === 0 && subs === 0) action = "delete";
      else if (subs > 0 && !costTotal) action = "add_spend";
      else if (clicks > 0 && subs === 0 && ageDays > 14) action = "review";
      else if (subs > 0 && costTotal > 0) action = "keep";

      return { ...l, ageDays, daysSinceActivity, cvr, subsPerDay, profit, roi, profitPerSub, action, username: usernameMap[l.account_id] || "" };
    })
    .sort((a: any, b: any) => {
      if ((b.subscribers || 0) !== (a.subscribers || 0)) return (b.subscribers || 0) - (a.subscribers || 0);
      if ((b.clicks || 0) !== (a.clicks || 0)) return (b.clicks || 0) - (a.clicks || 0);
      return (a.ageDays || 0) - (b.ageDays || 0);
    });

  const header = [
    "action", "campaign_name", "account_username", "campaign_url", "source_tag",
    "spend_type", "cost_value", "clicks", "subscribers", "cvr", "ltv", "ltv_per_sub",
    "spenders_count", "spender_rate", "profit", "roi", "profit_per_sub", "subs_per_day",
    "status", "created_date", "age_days", "last_activity", "days_since_activity", "campaign_id"
  ].join(",");

  const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const fmtPct = (v: number | null, dec = 1) => v !== null && v !== undefined ? `${v.toFixed(dec)}%` : "";
  const fmtDate = (d: string | null) => d ? format(new Date(d), "MMM dd yyyy") : "";

  const rows = active.map((l: any) => [
    l.action,
    esc(l.campaign_name || ""),
    esc(l.username),
    esc(l.url || ""),
    esc(l.source_tag || ""),
    esc(l.cost_type || ""),
    l.cost_value || "",
    l.clicks || 0,
    l.subscribers || 0,
    fmtPct(l.cvr),
    (l.ltv || l.revenue || 0).toFixed(2),
    (l.ltv_per_sub || 0).toFixed(2),
    l.spenders_count || 0,
    fmtPct(l.spender_rate),
    l.profit !== null ? l.profit.toFixed(2) : "",
    l.roi !== null ? fmtPct(l.roi) : "",
    l.profitPerSub !== null ? l.profitPerSub.toFixed(2) : "",
    l.subsPerDay.toFixed(2),
    esc(l.status || ""),
    fmtDate(l.created_at),
    l.ageDays,
    fmtDate(l.calculated_at),
    l.daysSinceActivity ?? "",
    l.id,
  ].join(","));

  const blob = new Blob([header + "\n" + rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "campaigns_audit.csv"; a.click();
  URL.revokeObjectURL(url);
}

export function ExportCampaignsCsvButton({ trackingLinks, accounts }: Props) {
  return (
    <Button variant="outline" size="sm" onClick={() => exportCampaignsCsv(trackingLinks, accounts)}>
      <Download className="h-4 w-4 mr-1" /> Export Tracking Links CSV
    </Button>
  );
}
