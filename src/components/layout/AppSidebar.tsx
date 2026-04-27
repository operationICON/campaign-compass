import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard, LayoutGrid, Users, BarChart3,
  Bell, Activity, Settings, Code2, LogOut, ShieldCheck, Tag, GitBranch, Calculator, Heart, ChevronLeft, ChevronRight
} from "lucide-react";
import { fetchAlerts } from "@/lib/supabase-helpers";
import { useAuth } from "@/contexts/AuthContext";
import { useState, useEffect } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const mainNav = [
  { to: "/", icon: LayoutDashboard, label: "Overview", adminOnly: true },
  { to: "/campaigns", icon: LayoutGrid, label: "Tracking Links", adminOnly: false },
  { to: "/cross-poll", icon: GitBranch, label: "Cross-Poll", adminOnly: true },
  { to: "/accounts", icon: Users, label: "Models", adminOnly: true },
  { to: "/fans", icon: Heart, label: "Fans", adminOnly: true },
  { to: "/traffic-sources", icon: Tag, label: "Sources", adminOnly: true },
  { to: "/audit", icon: ShieldCheck, label: "Audit", adminOnly: true },
  { to: "/charts", icon: BarChart3, label: "Charts", adminOnly: true },
];

const systemNav = [
  { to: "/calculations", icon: Calculator, label: "Calculations", adminOnly: true },
  { to: "/alerts", icon: Bell, label: "Alerts", hasBadge: true, adminOnly: true },
  { to: "/logs", icon: Activity, label: "Sync Logs", adminOnly: true },
  { to: "/settings", icon: Settings, label: "Settings", adminOnly: true },
  { to: "/debug", icon: Code2, label: "API Debug", adminOnly: true },
];

export function AppSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const isAdmin = user?.role === "admin";

  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("sidebar_collapsed") === "true"; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem("sidebar_collapsed", String(collapsed)); } catch {}
  }, [collapsed]);

  const { data: alerts = [] } = useQuery({
    queryKey: ["alerts_unresolved"],
    queryFn: () => fetchAlerts(true),
    enabled: isAdmin,
  });
  const unresolvedCount = (alerts as any[]).length;

  const visibleMain = mainNav.filter((item) => !item.adminOnly || isAdmin);
  const visibleSystem = systemNav.filter((item) => !item.adminOnly || isAdmin);

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  const initials = user?.name
    ? user.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
    : "?";

  const NavItem = ({ to, icon: Icon, label, hasBadge }: { to: string; icon: any; label: string; hasBadge?: boolean }) => {
    const isActive = location.pathname === to;
    const item = (
      <NavLink
        to={to}
        className={`relative flex items-center gap-3 rounded-lg text-[13px] font-medium transition-all duration-200 ${
          collapsed ? "justify-center px-0 py-2.5 w-10 mx-auto" : "px-4 py-2.5"
        } ${
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground border-l-[3px] border-sidebar-primary"
            : "text-sidebar-foreground hover:bg-[rgba(255,255,255,0.08)] hover:text-white border-l-[3px] border-transparent"
        }`}
      >
        <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} />
        {!collapsed && <span>{label}</span>}
        {!collapsed && hasBadge && unresolvedCount > 0 && (
          <span className="ml-auto bg-destructive text-destructive-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
            {unresolvedCount}
          </span>
        )}
        {collapsed && hasBadge && unresolvedCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full">
            {unresolvedCount}
          </span>
        )}
      </NavLink>
    );

    if (collapsed) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>{item}</TooltipTrigger>
          <TooltipContent side="right" className="text-xs">{label}</TooltipContent>
        </Tooltip>
      );
    }
    return item;
  };

  return (
    <TooltipProvider delayDuration={200}>
      <aside className={`${collapsed ? "w-[64px]" : "w-[220px]"} min-h-screen bg-sidebar flex flex-col transition-all duration-200 shrink-0`}>
        {/* Logo + collapse toggle */}
        <div className={`px-3 pt-5 pb-4 flex items-center ${collapsed ? "justify-center" : "justify-between"}`}>
          {!collapsed && (
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-[38px] h-[38px] rounded-[10px] gradient-bg flex items-center justify-center text-white font-bold text-sm shadow-lg shrink-0">
                CT
              </div>
              <div className="min-w-0">
                <div className="text-white font-bold text-sm leading-tight">CT Tracker</div>
                <div className="text-sidebar-foreground text-[11px]">Icon Models Agency</div>
              </div>
            </div>
          )}
          {collapsed && (
            <div className="w-[38px] h-[38px] rounded-[10px] gradient-bg flex items-center justify-center text-white font-bold text-sm shadow-lg shrink-0">
              CT
            </div>
          )}
          {!collapsed && (
            <button
              onClick={() => setCollapsed(true)}
              className="p-1 rounded-md text-sidebar-foreground hover:text-white hover:bg-[rgba(255,255,255,0.08)] transition-colors shrink-0"
              title="Collapse sidebar"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Expand button when collapsed */}
        {collapsed && (
          <button
            onClick={() => setCollapsed(false)}
            className="mx-auto mb-2 p-1.5 rounded-md text-sidebar-foreground hover:text-white hover:bg-[rgba(255,255,255,0.08)] transition-colors"
            title="Expand sidebar"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}

        {/* Main nav */}
        <nav className="flex-1 px-3 flex flex-col">
          {!collapsed && <div className="text-[10px] uppercase tracking-[0.12em] text-sidebar-foreground px-4 mb-2 mt-2">Main</div>}
          {collapsed && <div className="h-4" />}
          <div className="flex flex-col gap-0.5">
            {visibleMain.map((item) => (
              <NavItem key={item.to} {...item} />
            ))}
          </div>

          {visibleSystem.length > 0 && (
            <>
              <div className="w-full h-px bg-sidebar-border my-3" />
              {!collapsed && <div className="text-[10px] uppercase tracking-[0.12em] text-sidebar-foreground px-4 mb-2">System</div>}
              <div className="flex flex-col gap-0.5">
                {visibleSystem.map((item) => (
                  <NavItem key={item.to} {...item} />
                ))}
              </div>
            </>
          )}
        </nav>

        {/* User section */}
        <div className="border-t border-sidebar-border px-3 py-4 space-y-3">
          {!collapsed ? (
            <>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl gradient-bg flex items-center justify-center text-white text-sm font-bold shrink-0 shadow-md">
                  {initials}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-white text-[13px] font-semibold leading-tight truncate">{user?.name ?? "—"}</div>
                  <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full mt-1 ${
                    isAdmin ? "bg-primary/25 text-primary" : "bg-white/10 text-white/60"
                  }`}>
                    {isAdmin ? "Admin" : "User"}
                  </span>
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-lg bg-white/8 hover:bg-white/15 text-white/70 hover:text-white text-[12px] font-medium transition-all border border-white/10 hover:border-white/20"
              >
                <LogOut className="h-3.5 w-3.5" />
                Log out
              </button>
            </>
          ) : (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="w-10 h-10 rounded-xl gradient-bg flex items-center justify-center text-white text-sm font-bold mx-auto cursor-default shadow-md">
                    {initials}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs">{user?.name ?? "—"}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleLogout}
                    className="flex items-center justify-center w-10 h-8 mx-auto rounded-lg bg-white/8 hover:bg-white/15 text-white/70 hover:text-white transition-all border border-white/10"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs">Log out</TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
      </aside>
    </TooltipProvider>
  );
}
