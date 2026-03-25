import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { fetchAlerts } from "@/lib/supabase-helpers";
import { supabase } from "@/integrations/supabase/client";
import { format, formatDistanceToNow } from "date-fns";
import { AlertTriangle, TrendingDown, TrendingUp, DollarSign, Eye, X, Bell } from "lucide-react";
import { RefreshButton } from "@/components/RefreshButton";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

const ALERT_ICONS: Record<string, any> = {
  zero_clicks: AlertTriangle,
  negative_roi: TrendingDown,
  high_performer: TrendingUp,
  budget_exceeded: DollarSign,
  low_cvr: AlertTriangle,
};

const ALERT_COLORS: Record<string, string> = {
  zero_clicks: "text-destructive",
  negative_roi: "text-destructive",
  high_performer: "text-primary",
  budget_exceeded: "text-warning",
  low_cvr: "text-destructive",
};

export default function AlertsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: allAlerts = [], isLoading } = useQuery({ queryKey: ["all_alerts"], queryFn: () => fetchAlerts(false) });
  const unresolvedAlerts = allAlerts.filter((a: any) => !a.resolved);
  const resolvedAlerts = allAlerts.filter((a: any) => a.resolved);

  const dismissAlert = async (id: string) => {
    const { error } = await supabase.from("alerts").update({ resolved: true, resolved_at: new Date().toISOString() }).eq("id", id);
    if (error) { toast.error("Failed to dismiss"); return; }
    toast.success("Alert dismissed");
    queryClient.invalidateQueries({ queryKey: ["all_alerts"] });
    queryClient.invalidateQueries({ queryKey: ["alerts"] });
    queryClient.invalidateQueries({ queryKey: ["alerts_unresolved"] });
  };

  const AlertCard = ({ alert }: { alert: any }) => {
    const Icon = ALERT_ICONS[alert.type] || AlertTriangle;
    const color = ALERT_COLORS[alert.type] || "text-muted-foreground";

    return (
      <div className="bg-card border border-border rounded-lg p-5 card-hover">
        <div className="flex items-start gap-4">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${color} bg-current/10`}>
            <Icon className={`h-5 w-5 ${color}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-xs font-bold uppercase tracking-wider ${color}`}>{alert.type?.replace(/_/g, " ")}</span>
              <span className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(alert.triggered_at), { addSuffix: true })}
              </span>
            </div>
            <p className="text-sm font-semibold text-foreground mb-1">
              {alert.campaign_name || "Unknown Campaign"}
              {alert.account_name && <span className="text-muted-foreground font-normal"> · {alert.account_name}</span>}
            </p>
            <p className="text-xs text-muted-foreground">{alert.message || "No details"}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!alert.resolved && (
              <>
                <button
                  onClick={() => navigate("/")}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-primary/15 text-primary hover:bg-primary/25 transition-colors flex items-center gap-1"
                >
                  <Eye className="h-3 w-3" /> View
                </button>
                <button
                  onClick={() => dismissAlert(alert.id)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-secondary text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                >
                  <X className="h-3 w-3" /> Dismiss
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <Bell className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-xl font-bold text-foreground">Alerts</h1>
            <p className="text-sm text-muted-foreground">{unresolvedAlerts.length} unresolved alert{unresolvedAlerts.length !== 1 ? "s" : ""}</p>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => <div key={i} className="skeleton-shimmer h-24 rounded-lg" />)}
          </div>
        ) : !allAlerts.length ? (
          <div className="bg-card border border-border rounded-lg p-16 text-center text-muted-foreground">
            No alerts yet. Alerts will appear after syncing.
          </div>
        ) : (
          <>
            {unresolvedAlerts.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-xs font-bold text-destructive uppercase tracking-wider">Active Alerts</h2>
                {unresolvedAlerts.map((a: any) => <AlertCard key={a.id} alert={a} />)}
              </div>
            )}
            {resolvedAlerts.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Resolved</h2>
                {resolvedAlerts.slice(0, 10).map((a: any) => <AlertCard key={a.id} alert={a} />)}
              </div>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
