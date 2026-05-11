import { useState, useRef, useEffect } from "react";
import { ChevronDown, Search, Check } from "lucide-react";

interface AccountOption {
  id: string;
  username: string;
  display_name: string;
  avatar_thumb_url?: string | null;
  is_active?: boolean;
}

interface AccountFilterDropdownProps {
  value: string[];
  onChange: (value: string[]) => void;
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
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50);
    else setSearch("");
  }, [open]);

  const isAll = value.length === 0;
  const initials = (u: string) => (u || "?").replace("@", "").slice(0, 2).toUpperCase();

  const filtered = search
    ? accounts.filter(a =>
        (a.display_name || "").toLowerCase().includes(search.toLowerCase()) ||
        (a.username || "").toLowerCase().includes(search.toLowerCase())
      )
    : accounts;

  const toggle = (id: string) => {
    if (value.includes(id)) {
      const next = value.filter(x => x !== id);
      onChange(next);
    } else {
      onChange([...value, id]);
    }
  };

  const buttonLabel = () => {
    if (isAll) return `All Models (${accounts.length})`;
    if (value.length === 1) {
      const acc = accounts.find(a => a.id === value[0]);
      return acc?.display_name || acc?.username || "1 Model";
    }
    return `${value.length} Models`;
  };

  const singleSelected = !isAll && value.length === 1 ? accounts.find(a => a.id === value[0]) : null;

  return (
    <div ref={ref} className={`relative ${className || ""}`}>
      <button
        onClick={() => setOpen(!open)}
        className="h-10 min-w-0 px-3 rounded-lg border border-border bg-card text-sm text-foreground outline-none focus:ring-1 focus:ring-primary cursor-pointer flex items-center gap-2"
      >
        {singleSelected ? (
          <>
            {singleSelected.avatar_thumb_url ? (
              <img src={singleSelected.avatar_thumb_url} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
            ) : (
              <span className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0" style={{ backgroundColor: getInitialColor(singleSelected.username) }}>
                {initials(singleSelected.username)}
              </span>
            )}
          </>
        ) : null}
        <span className="whitespace-nowrap">{buttonLabel()}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-1 shrink-0" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 min-w-[260px] bg-card border border-border rounded-lg shadow-lg overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search models…"
                className="w-full h-8 pl-8 pr-3 text-xs rounded-md bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {/* Select All · Deselect All */}
          <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border">
            <button
              onClick={() => { onChange([]); setOpen(false); setSearch(""); }}
              className="text-xs text-primary hover:text-primary/80 transition-colors font-medium"
            >
              Select All
            </button>
            <span className="text-muted-foreground text-xs">·</span>
            <button
              onClick={() => { onChange([]); setOpen(false); setSearch(""); }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Deselect All
            </button>
          </div>

          {/* Options list */}
          <div className="max-h-64 overflow-y-auto py-1">
            {!search && (
              <button
                onClick={() => { onChange([]); setOpen(false); }}
                className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-secondary/50 transition-colors ${isAll ? "text-primary" : "text-foreground"}`}
              >
                <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${isAll ? "bg-primary border-primary" : "border-border"}`}>
                  {isAll && <Check className="w-2.5 h-2.5 text-white" />}
                </div>
                <span className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center text-[9px] font-bold text-primary shrink-0">
                  {accounts.length}
                </span>
                All Models
              </button>
            )}
            {filtered.map(acc => {
              const checked = value.includes(acc.id);
              return (
                <button
                  key={acc.id}
                  onClick={() => toggle(acc.id)}
                  className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2.5 hover:bg-secondary/50 transition-colors ${checked ? "text-primary" : "text-foreground"}`}
                >
                  <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${checked ? "bg-primary border-primary" : "border-border"}`}>
                    {checked && <Check className="w-2.5 h-2.5 text-white" />}
                  </div>
                  {acc.avatar_thumb_url ? (
                    <img src={acc.avatar_thumb_url} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
                  ) : (
                    <span className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0" style={{ backgroundColor: getInitialColor(acc.username) }}>
                      {initials(acc.username)}
                    </span>
                  )}
                  <span className="flex-1 truncate">{acc.display_name || `@${(acc.username || "").replace("@", "")}`}</span>
                  {acc.is_active === false && (
                    <span className="rounded-full bg-red-500/10 text-red-400 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 shrink-0">Ex</span>
                  )}
                </button>
              );
            })}
            {filtered.length === 0 && (
              <p className="px-3 py-4 text-xs text-muted-foreground text-center">No models match "{search}"</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
