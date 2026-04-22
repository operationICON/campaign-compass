import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getTrafficSources, createTrafficSource, updateTrackingLink } from "@/lib/api";

interface SourceTagDropdownProps {
  value: string;
  onChange: (value: string) => void;
  onSave: (value: string) => void;
  className?: string;
  trackingLinkId?: string;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

export function SourceTagDropdown({ value, onChange, onSave, className, trackingLinkId }: SourceTagDropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(value);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data: rules = [] } = useQuery({
    queryKey: ["traffic_sources"],
    queryFn: getTrafficSources,
  });

  useEffect(() => { setSearch(value); }, [value]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return rules;
    const q = search.toLowerCase();
    return rules.filter((r: any) => r.name.toLowerCase().includes(q));
  }, [rules, search]);

  const fuzzyMatch = useMemo(() => {
    if (!search.trim() || filtered.length > 0) return null;
    const q = search.toLowerCase();
    for (const r of rules) {
      const name = (r as any).name;
      if (name.toLowerCase() === q) return null;
      if (levenshtein(name.toLowerCase(), q) <= 2) return name;
    }
    return null;
  }, [search, filtered, rules]);

  const exactExists = rules.some((r: any) => r.name.toLowerCase() === search.trim().toLowerCase());

  const handleSelect = async (tagName: string) => {
    onChange(tagName);
    setSearch(tagName);
    setOpen(false);
    onSave(tagName);

    if (trackingLinkId) {
      const source = rules.find((r: any) => r.name === tagName);
      await updateTrackingLink(trackingLinkId, {
        source_tag: tagName,
        traffic_source_id: (source as any)?.id || null,
        manually_tagged: true,
        traffic_category: "Manual",
      });
      queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
    }
  };

  const handleCreate = async () => {
    const name = search.trim();
    if (!name) return;
    const existing = rules.find((r: any) => r.name.toLowerCase() === name.toLowerCase());
    if (!existing) {
      await createTrafficSource({ name });
      queryClient.invalidateQueries({ queryKey: ["traffic_sources"] });
    }
    handleSelect(name);
  };

  return (
    <div ref={ref} className={`relative ${className || ""}`} onClick={(e) => e.stopPropagation()}>
      <div
        className="flex items-center gap-1.5 w-full px-2.5 py-1.5 bg-secondary border border-border rounded-md text-[11px] text-foreground cursor-text"
        onClick={() => { setOpen(true); inputRef.current?.focus(); }}
      >
        {value && !open && (
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: (rules.find((r: any) => r.name === value) as any)?.color || "#0891b2" }} />
        )}
        <input
          ref={inputRef}
          type="text"
          value={open ? search : value}
          onChange={(e) => { setSearch(e.target.value); onChange(e.target.value); if (!open) setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search or create source..."
          className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground text-[11px]"
        />
      </div>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-full min-w-[200px] bg-card border border-border rounded-lg shadow-lg py-1 max-h-48 overflow-y-auto">
          {filtered.map((r: any) => (
            <button
              key={r.name}
              onClick={() => handleSelect(r.name)}
              className="w-full px-3 py-1.5 text-left text-[11px] flex items-center gap-2 hover:bg-secondary/50 transition-colors text-foreground"
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: r.color || "#0891b2" }} />
              {r.name}
            </button>
          ))}
          {fuzzyMatch && (
            <div className="px-3 py-1.5 text-[11px] text-[hsl(var(--warning))] flex items-center gap-1.5">
              <span>⚠️</span>
              <span>Did you mean <button onClick={() => handleSelect(fuzzyMatch)} className="font-bold underline">{fuzzyMatch}</button>?</span>
            </div>
          )}
          {search.trim() && !exactExists && (
            <button
              onClick={handleCreate}
              className="w-full px-3 py-1.5 text-left text-[11px] flex items-center gap-2 hover:bg-secondary/50 transition-colors text-primary font-medium border-t border-border/50"
            >
              <span>+</span> Create new source: <span className="font-bold">{search.trim()}</span>
            </button>
          )}
          {filtered.length === 0 && !search.trim() && (
            <p className="px-3 py-2 text-[11px] text-muted-foreground">No source tags defined yet</p>
          )}
        </div>
      )}
    </div>
  );
}
