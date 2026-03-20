import { NavLink, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard, Link2, Users, ShoppingBag, BarChart3,
  Bell, Activity, Settings, Code2
} from "lucide-react";
import { fetchAlerts } from "@/lib/supabase-helpers";

const navSections = [
  {
    label: "Main",
    items: [
      { to: "/", icon: LayoutDashboard, label: "Dashboard" },
      { to: "/tracking-links", icon: Link2, label: "Tracking Links" },
      { to: "/accounts", icon: Users, label: "Accounts" },
      { to: "/media-buyers", icon: ShoppingBag, label: "Media Buyers" },
      { to: "/charts", icon: BarChart3, label: "Charts" },
    ],
  },
  {
    label: "System",
    items: [
      { to: "/alerts", icon: Bell, label: "Alerts", hasBadge: true },
      { to: "/logs", icon: Activity, label: "Sync Logs" },
      { to: "/settings", icon: Settings, label: "Settings" },
      { to: "/debug", icon: Code2, label: "API Debug" },
    ],
  },
];

export function AppSidebar() {
  const location = useLocation();
  const { data: alerts = [] } = useQuery({ queryKey: ["alerts_unresolved"], queryFn: () => fetchAlerts(true) });
  const unresolvedCount = alerts.length;

  return (
    <aside className="w-[220px] min-h-screen bg-sidebar border-r border-sidebar-border flex flex-col">
      {/* Brand */}
      <div className="p-5 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="w-[38px] h-[38px] rounded-[10px] gradient-bg flex items-center justify-center text-white font-bold text-sm shadow-md">
            CT
          </div>
          <div>
            <h1 className="text-[14px] font-bold text-foreground leading-tight">Campaign Tracker</h1>
            <p className="text-[11px] text-muted-foreground leading-tight">Icon Models Agency</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-4">
        {navSections.map((section) => (
          <div key={section.label}>
            <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground font-medium px-3 mb-1.5">
              {section.label}
            </p>
            <div className="space-y-0.5">
              {section.items.map(({ to, icon: Icon, label, hasBadge }) => {
                const isActive = location.pathname === to;
                return (
                  <NavLink
                    key={to}
                    to={to}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-[10px] text-[13px] font-medium transition-all duration-200 relative ${
                      isActive
                        ? "bg-primary/10 text-foreground border-l-[3px] border-primary"
                        : "text-sidebar-foreground hover:bg-secondary hover:text-foreground border-l-[3px] border-transparent"
                    }`}
                  >
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
            </div>
          </div>
        ))}
      </nav>

      {/* User section */}
      <div className="p-4 border-t border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full gradient-bg flex items-center justify-center text-white text-sm font-bold">
            M
          </div>
          <div>
            <p className="text-[13px] font-semibold text-foreground leading-tight">Martin</p>
            <p className="text-[11px] text-muted-foreground leading-tight">Admin</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
