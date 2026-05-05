import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";

interface AccountOption {
  id: string;
  username: string;
  display_name: string;
  avatar_thumb_url?: string | null;
  is_active?: boolean;
}

interface AccountFilterDropdownProps {
  value: string;
  onChange: (value: string) => void;
  accounts: AccountOption[];
  className?: string;
}

const MODEL_COLORS: Record<string, string> = {
  j: "#e11d48", m: "#0891b2", z: "#7c3aed", e: "#ea580c", a: "#2563eb",
  s: "#16a34a", d: "#9333ea", r: "#dc2626", k: "#0d9488", l: "#c026d3",
};

function getInitialColor(username: string) {
  const first = (username || "?").replace("@", "").charAt(0).toLowerCase();
  return MODEL_COLORS[first] || "#6b7280";
}

export function AccountFilterDropdown({ value, onChange, accounts, className }: AccountFilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selected = value !== "all" ? accounts.find(a => a.id === value) : null;
  const initials = (u: string) => (u || "?").replace("@", "").slice(0, 2).toUpperCase();

  return (
    <div ref={ref} className={`relative ${className || ""}`}>
      <button
        onClick={() => setOpen(!open)}
        className="h-10 min-w-0 w-full px-3 rounded-lg border border-border bg-card text-sm text-foreground outline-none focus:ring-1 focus:ring-primary cursor-pointer flex items-center gap-2"
      >
        {selected ? (
          <>
            {selected.avatar_thumb_url ? (
              <img src={selected.avatar_thumb_url} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
            ) : (
              <span className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0" style={{ backgroundColor: getInitialColor(selected.username) }}>
                {initials(selected.username)}
              </span>
            )}
            <span className="truncate">@{(selected.username || "").replace("@", "")}</span>
            {selected.is_active === false && (
              <span className="rounded-full bg-red-500/10 text-red-400 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5">
                Ex-Model
              </span>
            )}
          </>
        ) : (
          <span>All Accounts</span>
        )}
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-auto shrink-0" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 min-w-[240px] w-full bg-card border border-border rounded-lg shadow-lg py-1 max-h-80 overflow-y-auto">
          <button
            onClick={() => { onChange("all"); setOpen(false); }}
            className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-secondary/50 transition-colors ${value === "all" ? "bg-primary/5 text-primary font-medium" : "text-foreground"}`}
          >
            All Accounts
          </button>
          {accounts.map(acc => (
            <button
              key={acc.id}
              onClick={() => { onChange(acc.id); setOpen(false); }}
              className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2.5 hover:bg-secondary/50 transition-colors ${value === acc.id ? "bg-primary/5 text-primary font-medium" : "text-foreground"}`}
            >
              {acc.avatar_thumb_url ? (
                <img src={acc.avatar_thumb_url} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
              ) : (
                <span className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0" style={{ backgroundColor: getInitialColor(acc.username) }}>
                  {initials(acc.username)}
                </span>
              )}
              <span>@{(acc.username || "").replace("@", "")}</span>
              {acc.is_active === false && (
                <span className="rounded-full bg-red-500/10 text-red-400 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5">
                  Ex-Model
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
