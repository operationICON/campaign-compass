import { NavLink, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Users, AlertTriangle, LayoutDashboard, Bug, UserCheck, LineChart, Settings, Bell, Link2 } from "lucide-react";
import { fetchAlerts } from "@/lib/supabase-helpers";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/tracking-links", icon: Link2, label: "Tracking Links" },
  { to: "/accounts", icon: Users, label: "Accounts" },
  { to: "/media-buyers", icon: UserCheck, label: "Media Buyers" },
  { to: "/charts", icon: LineChart, label: "Charts" },
  { to: "/alerts", icon: Bell, label: "Alerts", hasBadge: true },
  { to: "/logs", icon: AlertTriangle, label: "Sync Logs" },
  { to: "/settings", icon: Settings, label: "Settings" },
  { to: "/debug", icon: Bug, label: "API Debug" },
];

export function AppSidebar() {
  const location = useLocation();
  const { data: alerts = [] } = useQuery({ queryKey: ["alerts_unresolved"], queryFn: () => fetchAlerts(true) });
  const unresolvedCount = alerts.length;

  return (
    <aside className="w-56 min-h-screen bg-sidebar border-r border-border flex flex-col">
      <div className="p-5 border-b border-border">
        <h1 className="text-base font-semibold text-foreground tracking-tight">Campaign Tracker</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Internal Dashboard</p>
      </div>
      <nav className="flex-1 p-3 space-y-0.5">
        {navItems.map(({ to, icon: Icon, label, hasBadge }) => {
          const isActive = location.pathname === to;
          return (
            <NavLink
              key={to}
              to={to}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 relative ${
                isActive
                  ? "bg-primary/10 text-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-primary" />
              )}
              <Icon className={`h-4 w-4 ${isActive ? "text-primary" : ""}`} />
              {label}
              {hasBadge && unresolvedCount > 0 && (
                <span className="ml-auto bg-destructive text-destructive-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                  {unresolvedCount}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
