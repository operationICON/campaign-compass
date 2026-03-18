import { NavLink, useLocation } from "react-router-dom";
import { BarChart3, Users, ScrollText, AlertTriangle, LayoutDashboard, Bug } from "lucide-react";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/accounts", icon: Users, label: "Accounts" },
  { to: "/ad-spend", icon: ScrollText, label: "Ad Spend" },
  { to: "/logs", icon: AlertTriangle, label: "Sync Logs" },
  { to: "/debug", icon: Bug, label: "API Debug" },
];

export function AppSidebar() {
  const location = useLocation();

  return (
    <aside className="w-60 min-h-screen bg-sidebar border-r border-sidebar-border flex flex-col">
      <div className="p-5 border-b border-sidebar-border">
        <h1 className="text-lg font-bold gradient-text tracking-tight">Campaign Tracker</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Internal Dashboard</p>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {navItems.map(({ to, icon: Icon, label }) => {
          const isActive = location.pathname === to;
          return (
            <NavLink
              key={to}
              to={to}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
              }`}
            >
              <Icon className={`h-4 w-4 ${isActive ? "text-primary" : ""}`} />
              {label}
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
