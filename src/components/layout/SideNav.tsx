import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  PieChart, LayoutGrid, Users, Tag, Heart, LineChart, GitBranch,
  ShieldCheck, BarChart3, Calculator, Bell, Activity, Settings, Code2,
  ChevronLeft, ChevronRight, LogOut,
} from "lucide-react";
import { fetchAlerts } from "@/lib/supabase-helpers";
import { useAuth } from "@/contexts/AuthContext";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

const MAIN_NAV = [
  { to: "/overview",           icon: PieChart,   label: "Overview",       adminOnly: true  },
  { to: "/campaigns",          icon: LayoutGrid, label: "Tracking Links"                   },
  { to: "/accounts",           icon: Users,      label: "Models",         adminOnly: true  },
  { to: "/traffic-sources",    icon: Tag,        label: "Sources",        adminOnly: true  },
  { to: "/fans",               icon: Heart,      label: "Fans",           adminOnly: true  },
  { to: "/campaign-analytics", icon: LineChart,  label: "Analytics",      adminOnly: true  },
  { to: "/cross-poll",         icon: GitBranch,  label: "Cross-Poll",     adminOnly: true  },
];

const SYSTEM_NAV = [
  { to: "/audit",        icon: ShieldCheck, label: "Audit"        },
  { to: "/charts",       icon: BarChart3,   label: "Charts"       },
  { to: "/calculations", icon: Calculator,  label: "Calculations" },
  { to: "/alerts",       icon: Bell,        label: "Alerts",       hasBadge: true },
  { to: "/logs",         icon: Activity,    label: "Sync Logs"    },
  { to: "/settings",     icon: Settings,    label: "Settings"     },
  { to: "/debug",        icon: Code2,       label: "API Debug"    },
];

export function SideNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const isAdmin = user?.role === "admin";

  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("sidenav_collapsed") === "true"; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem("sidenav_collapsed", String(collapsed)); } catch {}
  }, [collapsed]);

  const { data: alerts = [] } = useQuery({
    queryKey: ["alerts_unresolved"],
    queryFn: () => fetchAlerts(true),
    enabled: isAdmin,
    staleTime: 60_000,
  });
  const unresolvedCount = (alerts as any[]).length;

  const visibleMain   = MAIN_NAV.filter(item => !item.adminOnly || isAdmin);
  const visibleSystem = SYSTEM_NAV;

  const initials = user?.name
    ? user.name.split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2)
    : "?";

  const NavItem = ({ to, icon: Icon, label, hasBadge }: {
    to: string; icon: any; label: string; hasBadge?: boolean;
  }) => {
    const active = location.pathname === to;
    return (
      <NavLink
        to={to}
        title={collapsed ? label : undefined}
        className={cn(
          "relative flex items-center rounded-md text-sm font-medium transition-colors select-none",
          collapsed ? "justify-center w-9 h-9 mx-auto" : "gap-2.5 px-2.5 py-2 w-full",
          active
            ? "text-[#f1f5f9]"
            : "text-[#8b9ab1] hover:text-[#f1f5f9] hover:bg-[#1c1f2b]/60"
        )}
        style={active ? { background: "#1c1f2b" } : {}}
      >
        {/* blue active bar */}
        {active && !collapsed && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-full"
            style={{ background: "#3b82f6" }} />
        )}
        <Icon className="w-[17px] h-[17px] shrink-0" style={{ color: active ? "#3b82f6" : undefined }} />
        {!collapsed && <span className="truncate">{label}</span>}
        {/* badge */}
        {hasBadge && unresolvedCount > 0 && (
          collapsed
            ? <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-[#ef4444] text-white text-[9px] font-bold flex items-center justify-center rounded-full">
                {unresolvedCount > 9 ? "9" : unresolvedCount}
              </span>
            : <span className="ml-auto bg-[#ef4444] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0">
                {unresolvedCount}
              </span>
        )}
      </NavLink>
    );
  };

  return (
    <aside
      className="flex flex-col h-full shrink-0 overflow-hidden transition-all duration-200"
      style={{
        width: collapsed ? "52px" : "200px",
        background: "#080a0d",
        borderRight: "1px solid #1c1f2b",
      }}
    >
      {/* Logo + collapse toggle */}
      <div className="h-12 flex items-center gap-2.5 px-3 shrink-0"
        style={{ borderBottom: "1px solid #1c1f2b" }}>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white font-bold text-xs shrink-0"
          style={{ background: "#3b82f6" }}>
          CT
        </div>
        {!collapsed && (
          <span className="text-sm font-semibold whitespace-nowrap flex-1" style={{ color: "#f1f5f9" }}>
            CT Tracker
          </span>
        )}
        <button
          onClick={() => setCollapsed(v => !v)}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "flex items-center justify-center rounded-md transition-colors text-[#8b9ab1] hover:text-[#f1f5f9] hover:bg-[#1c1f2b]/60",
            collapsed ? "w-9 h-9 mx-auto" : "w-7 h-7 ml-auto shrink-0"
          )}
        >
          {collapsed
            ? <ChevronRight className="w-[17px] h-[17px]" />
            : <ChevronLeft className="w-[17px] h-[17px]" />}
        </button>
      </div>

      {/* Main nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 flex flex-col gap-0.5">
        {!collapsed && (
          <p className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#4a5568" }}>
            Main
          </p>
        )}
        {visibleMain.map(item => <NavItem key={item.to} {...item} />)}

        {isAdmin && (
          <>
            <div className="my-2 mx-1" style={{ height: "1px", background: "#1c1f2b" }} />
            {!collapsed && (
              <p className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#4a5568" }}>
                System
              </p>
            )}
            {visibleSystem.map(item => <NavItem key={item.to} {...item} />)}
          </>
        )}
      </nav>

      {/* User + collapse */}
      <div className="shrink-0 px-2 py-2 flex flex-col gap-0.5"
        style={{ borderTop: "1px solid #1c1f2b" }}>

        {/* User avatar + info */}
        {collapsed ? (
          <div className="flex justify-center py-1">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold"
              style={{ background: "#1e2d45" }} title={user?.name ?? "—"}>
              {initials}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-2.5 py-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0"
              style={{ background: "#1e2d45" }}>
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold truncate" style={{ color: "#f1f5f9" }}>{user?.name ?? "—"}</div>
              <div className="text-[10px] truncate" style={{ color: "#475569" }}>{user?.email ?? "—"}</div>
            </div>
          </div>
        )}

        {/* Logout */}
        <button
          onClick={() => { logout(); navigate("/login", { replace: true }); }}
          title={collapsed ? "Log out" : undefined}
          className={cn(
            "flex items-center rounded-md text-sm font-medium transition-colors text-[#8b9ab1] hover:text-[#f1f5f9] hover:bg-[#1c1f2b]/60",
            collapsed ? "justify-center w-9 h-9 mx-auto" : "gap-2.5 px-2.5 py-2 w-full"
          )}
        >
          <LogOut className="w-[17px] h-[17px] shrink-0" />
          {!collapsed && "Log out"}
        </button>
      </div>
    </aside>
  );
}
