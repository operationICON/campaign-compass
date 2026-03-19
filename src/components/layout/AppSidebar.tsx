import { NavLink, useLocation } from "react-router-dom";
import { BarChart3, Users, ScrollText, AlertTriangle, LayoutDashboard, Bug, UserCheck } from "lucide-react";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/accounts", icon: Users, label: "Accounts" },
  { to: "/ad-spend", icon: ScrollText, label: "Ad Spend" },
  { to: "/media-buyers", icon: UserCheck, label: "Media Buyers" },
  { to: "/logs", icon: AlertTriangle, label: "Sync Logs" },
  { to: "/debug", icon: Bug, label: "API Debug" },
];

export function AppSidebar() {
  const location = useLocation();

  return (
    <aside className="w-56 min-h-screen bg-[#050506] border-r border-white/[0.06] flex flex-col">
      <div className="p-5 border-b border-white/[0.06]">
        <h1 className="text-base font-semibold text-foreground tracking-tight">Campaign Tracker</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Internal Dashboard</p>
      </div>
      <nav className="flex-1 p-3 space-y-0.5">
        {navItems.map(({ to, icon: Icon, label }) => {
          const isActive = location.pathname === to;
          return (
            <NavLink
              key={to}
              to={to}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors relative ${
                isActive
                  ? "bg-primary/10 text-foreground"
                  : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
              }`}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-primary" />
              )}
              <Icon className={`h-4 w-4 ${isActive ? "text-primary" : ""}`} />
              {label}
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
