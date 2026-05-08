import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bell, ChevronDown, LogOut } from "lucide-react";
import { fetchAlerts } from "@/lib/supabase-helpers";
import { useAuth } from "@/contexts/AuthContext";
import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

const PRIMARY: { to: string; label: string; adminOnly?: boolean }[] = [
  { to: "/overview",           label: "Overview",       adminOnly: true  },
  { to: "/campaigns",          label: "Tracking Links"                   },
  { to: "/accounts",           label: "Models",         adminOnly: true  },
  { to: "/traffic-sources",    label: "Sources",        adminOnly: true  },
  { to: "/fans",               label: "Fans",           adminOnly: true  },
  { to: "/campaign-analytics", label: "Analytics",      adminOnly: true  },
  { to: "/cross-poll",         label: "Cross-Poll",     adminOnly: true  },
];

const MORE: { to: string; label: string; hasBadge?: boolean }[] = [
  { to: "/audit",        label: "Audit"        },
  { to: "/charts",       label: "Charts"       },
  { to: "/calculations", label: "Calculations" },
  { to: "/alerts",       label: "Alerts",        hasBadge: true },
  { to: "/logs",         label: "Sync Logs"    },
  { to: "/settings",     label: "Settings"     },
  { to: "/debug",        label: "API Debug"    },
];

export function TopNav() {
  const location  = useLocation();
  const navigate  = useNavigate();
  const { user, logout } = useAuth();
  const isAdmin   = user?.role === "admin";
  const [moreOpen, setMoreOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserOpen(false);
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  const { data: alerts = [] } = useQuery({
    queryKey: ["alerts_unresolved"],
    queryFn: () => fetchAlerts(true),
    enabled: isAdmin,
    staleTime: 60_000,
  });
  const unresolvedCount = (alerts as any[]).length;

  const visiblePrimary = PRIMARY.filter(item => !item.adminOnly || isAdmin);

  const initials = user?.name
    ? user.name.split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2)
    : "?";

  const navLinkCls = (active: boolean) => cn(
    "px-3 h-8 flex items-center text-sm font-medium rounded-md transition-colors whitespace-nowrap select-none",
    active
      ? "text-[#f1f5f9] bg-[#1e2130]"
      : "text-[#475569] hover:text-[#f1f5f9]"
  );

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 h-12 flex items-center px-5 gap-0"
      style={{ background: "#08090c", borderBottom: "1px solid #1e2130" }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5 shrink-0 mr-8">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center text-white font-bold text-xs shrink-0"
          style={{ background: "#3b82f6" }}
        >
          CT
        </div>
        <span className="text-sm font-semibold hidden sm:block" style={{ color: "#f1f5f9" }}>
          CT Tracker
        </span>
      </div>

      {/* Primary nav */}
      <div className="flex-1 flex items-center justify-center gap-0.5">
        {visiblePrimary.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={() => navLinkCls(location.pathname === item.to)}
          >
            {item.label}
          </NavLink>
        ))}

        {/* More dropdown — admin only */}
        {isAdmin && (
          <div ref={moreRef} className="relative">
            <button
              onClick={() => setMoreOpen(v => !v)}
              className={navLinkCls(MORE.some(m => location.pathname === m.to))}
            >
              More
              <ChevronDown className={cn("w-3 h-3 ml-1 transition-transform", moreOpen && "rotate-180")} />
            </button>
            {moreOpen && (
              <div
                className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 w-44 rounded-xl shadow-2xl py-1 z-50"
                style={{ background: "#0e1015", border: "1px solid #1e2130" }}
              >
                {MORE.map(item => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      "flex items-center justify-between px-3 py-2 text-sm transition-colors",
                      location.pathname === item.to
                        ? "text-[#3b82f6]"
                        : "text-[#475569] hover:text-[#f1f5f9] hover:bg-[#1e2130]/50"
                    )}
                  >
                    {item.label}
                    {item.hasBadge && unresolvedCount > 0 && (
                      <span className="bg-[#ef4444] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                        {unresolvedCount}
                      </span>
                    )}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right: alerts + user */}
      <div className="flex items-center gap-2 shrink-0 ml-8">
        {isAdmin && (
          <NavLink
            to="/alerts"
            className="relative w-8 h-8 flex items-center justify-center rounded-md transition-colors text-[#475569] hover:text-[#f1f5f9]"
          >
            <Bell className="w-4 h-4" />
            {unresolvedCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-[#ef4444] text-white text-[9px] font-bold flex items-center justify-center rounded-full">
                {unresolvedCount > 9 ? "9+" : unresolvedCount}
              </span>
            )}
          </NavLink>
        )}

        <div ref={userRef} className="relative">
          <button
            onClick={() => setUserOpen(v => !v)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold transition-opacity hover:opacity-75"
            style={{ background: "#1e2d45" }}
          >
            {initials}
          </button>
          {userOpen && (
            <div
              className="absolute top-full right-0 mt-1.5 w-52 rounded-xl shadow-2xl py-1 z-50"
              style={{ background: "#0e1015", border: "1px solid #1e2130" }}
            >
              <div className="px-3 py-2.5" style={{ borderBottom: "1px solid #1e2130" }}>
                <div className="text-sm font-semibold" style={{ color: "#f1f5f9" }}>{user?.name ?? "—"}</div>
                <div className="text-xs mt-0.5" style={{ color: "#475569" }}>{user?.email ?? "—"}</div>
              </div>
              <button
                onClick={() => { logout(); navigate("/login", { replace: true }); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors text-[#475569] hover:text-[#f1f5f9] hover:bg-[#1e2130]/50"
              >
                <LogOut className="w-3.5 h-3.5" />
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
