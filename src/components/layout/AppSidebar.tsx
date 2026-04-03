import { NavLink, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard, LayoutGrid, Users, BarChart3,
  Bell, Activity, Settings, Code2, LogOut, ShieldCheck, Tag, GitBranch, Calculator
} from "lucide-react";
import { fetchAlerts } from "@/lib/supabase-helpers";

const mainNav = [
  { to: "/", icon: LayoutDashboard, label: "Overview" },
  { to: "/campaigns", icon: LayoutGrid, label: "Tracking Links" },
  { to: "/cross-poll", icon: GitBranch, label: "Cross-Poll" },
  { to: "/accounts", icon: Users, label: "Models" },
  { to: "/traffic-sources", icon: Tag, label: "Sources" },
  { to: "/audit", icon: ShieldCheck, label: "Audit" },
  { to: "/charts", icon: BarChart3, label: "Charts" },
];

const systemNav = [
  { to: "/calculations", icon: Calculator, label: "Calculations" },
  { to: "/alerts", icon: Bell, label: "Alerts", hasBadge: true },
  { to: "/logs", icon: Activity, label: "Sync Logs" },
  { to: "/settings", icon: Settings, label: "Settings" },
  { to: "/debug", icon: Code2, label: "API Debug" },
];

export function AppSidebar() {
  const location = useLocation();
  const { data: alerts = [] } = useQuery({ queryKey: ["alerts_unresolved"], queryFn: () => fetchAlerts(true) });
  const unresolvedCount = alerts.length;

  const NavItem = ({ to, icon: Icon, label, hasBadge }: { to: string; icon: any; label: string; hasBadge?: boolean }) => {
    const isActive = location.pathname === to;
    return (
      <NavLink
        to={to}
        className={`relative flex items-center gap-3 px-4 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-200 ${
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground border-l-[3px] border-sidebar-primary"
            : "text-sidebar-foreground hover:bg-[rgba(255,255,255,0.08)] hover:text-white border-l-[3px] border-transparent"
        }`}
      >
        <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} />
        <span>{label}</span>
        {hasBadge && unresolvedCount > 0 && (
          <span className="ml-auto bg-destructive text-destructive-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
            {unresolvedCount}
          </span>
        )}
      </NavLink>
    );
  };

  return (
    <aside className="w-[220px] min-h-screen bg-sidebar flex flex-col">
      {/* Logo */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-[38px] h-[38px] rounded-[10px] gradient-bg flex items-center justify-center text-white font-bold text-sm shadow-lg shrink-0">
            CT
          </div>
          <div>
            <div className="text-white font-bold text-sm leading-tight">CT Tracker</div>
            <div className="text-sidebar-foreground text-[11px]">Icon Models Agency</div>
          </div>
        </div>
      </div>

      {/* Main nav */}
      <nav className="flex-1 px-3 flex flex-col">
        <div className="text-[10px] uppercase tracking-[0.12em] text-sidebar-foreground px-4 mb-2 mt-2">Main</div>
        <div className="flex flex-col gap-0.5">
          {mainNav.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </div>

        <div className="w-full h-px bg-sidebar-border my-3" />

        <div className="text-[10px] uppercase tracking-[0.12em] text-sidebar-foreground px-4 mb-2">System</div>
        <div className="flex flex-col gap-0.5">
          {systemNav.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </div>
      </nav>

      {/* User section */}
      <div className="border-t border-sidebar-border px-4 py-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full gradient-bg flex items-center justify-center text-white text-xs font-bold shrink-0">
            M
          </div>
          <div>
            <div className="text-white text-[13px] font-medium leading-tight">Martin</div>
            <div className="text-sidebar-foreground text-[11px]">Admin</div>
          </div>
        </div>
        <button className="flex items-center gap-2 text-sidebar-foreground hover:text-white text-[12px] transition-colors w-full px-1">
          <LogOut className="h-3.5 w-3.5" />
          <span>Log out</span>
        </button>
      </div>
    </aside>
  );
}
