import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface SourceTagDropdownProps {
  value: string;
  onChange: (value: string) => void;
  onSave: (value: string) => void;
  trackingLinkId?: string;
  className?: string;
}

export function SourceTagDropdown({ value, onChange, onSave, trackingLinkId, className }: SourceTagDropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(value || "");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data: sources = [] } = useQuery({
    queryKey: ["traffic_sources"],
    queryFn: async () => {
      const { data } = await supabase.from("traffic_sources").select("id, name, color").order("name");
      return data || [];
    },
  });

  useEffect(() => {
    setSearch(value || "");
  }, [value]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return sources;
    const q = search.toLowerCase();
    return sources.filter((s: any) => s.name.toLowerCase().includes(q));
  }, [sources, search]);

  const exactExists = sources.some((s: any) => s.name.toLowerCase() === search.trim().toLowerCase());

  const handleSelect = async (name: string) => {
    setSearch(name);
    onChange(name);
    setOpen(false);

    if (trackingLinkId) {
      try {
        const selected = sources.find((s: any) => s.name === name);
        await supabase
          .from("tracking_links")
          .update({
            source_tag: name,
            traffic_source_id: selected?.id || null,
            manually_tagged: true,
            traffic_category: "Manual",
          })
          .eq("id", trackingLinkId);
        queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
        toast.success("Source saved");
      } catch {
        toast.error("Failed to save source");
        return;
      }
    }
    onSave(name);
  };

  const handleCreate = async () => {
    const name = search.trim();
    if (!name) return;

    const { data: newSource, error } = await supabase
      .from("traffic_sources")
      .insert({ name })
      .select("id, name")
      .single();

    if (error) {
      toast.error("Failed to create source");
      return;
    }

    queryClient.invalidateQueries({ queryKey: ["traffic_sources"] });
    await handleSelect(name);
  };

  const handleClear = async () => {
    setSearch("");
    onChange("");
    setOpen(false);

    if (trackingLinkId) {
      try {
        await supabase
          .from("tracking_links")
          .update({
            source_tag: null,
            traffic_source_id: null,
            manually_tagged: false,
          })
          .eq("id", trackingLinkId);
        queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
        toast.success("Source cleared");
      } catch {
        toast.error("Failed to clear source");
      }
    }
    onSave("");
  };

  return (
    <div ref={ref} className={`relative ${className || ""}`} onClick={(e) => e.stopPropagation()}>
      <div
        className="flex items-center gap-1.5 w-full px-2.5 py-1.5 bg-secondary border border-border rounded-md text-[11px] text-foreground cursor-text"
        onClick={() => {
          setOpen(true);
          inputRef.current?.focus();
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            onChange(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search or type new source..."
          className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground text-[11px]"
        />
      </div>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-full min-w-[200px] bg-card border border-border rounded-lg shadow-lg py-1 max-h-48 overflow-y-auto">
          {/* Existing sources */}
          {filtered.map((s: any) => (
            <button
              key={s.id}
              onClick={() => handleSelect(s.name)}
              className="w-full px-3 py-1.5 text-left text-[11px] flex items-center gap-2 hover:bg-secondary/50 transition-colors text-foreground"
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color || "#0891b2" }} />
              {s.name}
            </button>
          ))}

          {/* Create new */}
          {search.trim() && !exactExists && (
            <button
              onClick={handleCreate}
              className="w-full px-3 py-1.5 text-left text-[11px] flex items-center gap-2 hover:bg-secondary/50 transition-colors text-primary font-medium border-t border-border/50"
            >
              + Create: <span className="font-bold">{search.trim()}</span>
            </button>
          )}

          {/* Clear */}
          {value && (
            <button
              onClick={handleClear}
              className="w-full px-3 py-1.5 text-left text-[11px] text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors border-t border-border/50"
            >
              ✕ Clear selection
            </button>
          )}

          {sources.length === 0 && !search.trim() && (
            <p className="px-3 py-2 text-[11px] text-muted-foreground">No sources yet — type to create one</p>
          )}
        </div>
      )}
    </div>
  );
}
