import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface TrafficSourceDropdownProps {
  value: string | null;
  trafficSourceId: string | null;
  onSave: (sourceTag: string, trafficSourceId: string) => void;
  className?: string;
}

async function fetchTrafficSources() {
  const { data, error } = await supabase
    .from("traffic_sources")
    .select("*")
    .order("name");
  if (error) throw error;
  return data || [];
}

export function TrafficSourceDropdown({ value, trafficSourceId, onSave, className }: TrafficSourceDropdownProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState<"Direct" | "OnlyTraffic">("Direct");
  const [newKeywords, setNewKeywords] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: sources = [] } = useQuery({
    queryKey: ["traffic_sources"],
    queryFn: fetchTrafficSources,
  });

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return sources;
    const q = search.toLowerCase();
    return sources.filter((s: any) => s.name.toLowerCase().includes(q));
  }, [sources, search]);

  const handleSelect = (source: any) => {
    setOpen(false);
    setSearch("");
    onSave(source.name, source.id);
  };

  const handleCreateNew = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const keywords = newKeywords.split(",").map(k => k.trim().toLowerCase()).filter(Boolean);
      const { data, error } = await supabase
        .from("traffic_sources")
        .insert({
          name: newName.trim(),
          category: "Manual",
          keywords,
          color: "#0891b2",
        })
        .select()
        .single();
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["traffic_sources"] });
      setCreating(false);
      setNewName("");
      setNewKeywords("");
      onSave(data.name, data.id);
    } catch (err: any) {
      toast.error("Failed to create source");
    } finally {
      setSaving(false);
    }
  };

  const currentSource = sources.find((s: any) => s.id === trafficSourceId || s.name === value);

  return (
    <div ref={ref} className={`relative ${className || ""}`} onClick={(e) => e.stopPropagation()}>

      {/* Search input */}
      <div
        className="flex items-center gap-1.5 w-full px-2.5 py-1.5 bg-secondary border border-border rounded-md text-[11px] text-foreground cursor-text"
        onClick={() => { setOpen(true); inputRef.current?.focus(); }}
      >
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); if (!open) setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search or create source..."
          className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground text-[11px]"
        />
      </div>

      {/* Dropdown */}
      {open && !creating && (
        <div className="absolute left-0 top-full mt-1 z-50 w-full min-w-[220px] bg-card border border-border rounded-lg shadow-lg py-1 max-h-48 overflow-y-auto">
          {filtered.map((s: any) => (
            <button
              key={s.id}
              onClick={() => handleSelect(s)}
              className="w-full px-3 py-1.5 text-left text-[11px] flex items-center gap-2 hover:bg-secondary/50 transition-colors text-foreground"
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color || "#0891b2" }} />
              <span className="flex-1">{s.name}</span>
              <span className="text-[10px] text-muted-foreground">{s.campaign_count}</span>
            </button>
          ))}
          <button
            onClick={() => { setCreating(true); setNewName(search); }}
            className="w-full px-3 py-1.5 text-left text-[11px] flex items-center gap-2 hover:bg-secondary/50 transition-colors text-primary font-medium border-t border-border/50"
          >
            <span>+</span> Create new source...
          </button>
          {filtered.length === 0 && !search.trim() && (
            <p className="px-3 py-2 text-[11px] text-muted-foreground">No sources defined yet</p>
          )}
        </div>
      )}

      {/* Inline create form */}
      {creating && (
        <div className="absolute left-0 top-full mt-1 z-50 w-full min-w-[240px] bg-card border border-border rounded-lg shadow-lg p-3 space-y-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Source name..."
            className="w-full px-2.5 py-1.5 bg-secondary border border-border rounded-md text-[11px] text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary"
            autoFocus
          />
          <input
            type="text"
            value={newKeywords}
            onChange={(e) => setNewKeywords(e.target.value)}
            placeholder="Keywords (comma separated)..."
            className="w-full px-2.5 py-1.5 bg-secondary border border-border rounded-md text-[11px] text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary"
          />
          <div className="flex gap-1.5">
            <button
              onClick={handleCreateNew}
              disabled={!newName.trim() || saving}
              className="flex-1 py-1.5 rounded-md bg-primary text-primary-foreground text-[11px] font-semibold hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save New"}
            </button>
            <button
              onClick={() => { setCreating(false); setNewName(""); setNewKeywords(""); }}
              className="px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
