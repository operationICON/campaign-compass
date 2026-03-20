import { NavLink, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard, Link2, Users, UserMinus, BarChart3,
  Bell, Activity, Settings, Code2
} from "lucide-react";
import { fetchAlerts } from "@/lib/supabase-helpers";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const mainNav = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/tracking-links", icon: Link2, label: "Tracking Links" },
  { to: "/accounts", icon: Users, label: "Accounts" },
  { to: "/media-buyers", icon: UserMinus, label: "Media Buyers" },
  { to: "/charts", icon: BarChart3, label: "Charts" },
];

const systemNav = [
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
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <NavLink
            to={to}
            className={`relative w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-200 ${
              isActive
                ? "gradient-bg shadow-md"
                : "hover:bg-white/[0.08]"
            }`}
          >
            <Icon className={`h-[18px] w-[18px] ${
              isActive ? "text-white" : "text-sidebar-foreground"
            }`} strokeWidth={1.8} />
            {hasBadge && unresolvedCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-destructive border-2 border-sidebar" />
            )}
          </NavLink>
        </TooltipTrigger>
        <TooltipContent side="right" className="bg-foreground text-background text-xs font-medium px-3 py-1.5 rounded-lg">
          {label}
        </TooltipContent>
      </Tooltip>
    );
  };

  return (
    <aside className="w-[72px] min-h-screen bg-sidebar flex flex-col items-center py-4">
      {/* Logo */}
      <div className="mb-6">
        <div className="w-[42px] h-[42px] rounded-xl gradient-bg flex items-center justify-center text-white font-bold text-sm shadow-lg">
          CT
        </div>
      </div>

      {/* Main nav */}
      <nav className="flex-1 flex flex-col items-center gap-1.5">
        {mainNav.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}

        {/* Separator */}
        <div className="w-8 h-px bg-sidebar-border my-2" />

        {systemNav.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </nav>

      {/* User avatar */}
      <div className="mt-4">
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <div className="w-9 h-9 rounded-full gradient-bg flex items-center justify-center text-white text-sm font-bold cursor-default">
              M
            </div>
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-foreground text-background text-xs font-medium px-3 py-1.5 rounded-lg">
            Martin · Admin
          </TooltipContent>
        </Tooltip>
      </div>
    </aside>
  );
}
