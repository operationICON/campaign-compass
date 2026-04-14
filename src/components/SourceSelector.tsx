import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface SourceSelectorProps {
  currentSourceTag: string | null;
  currentTrafficSourceId: string | null;
  trackingLinkId: string;
  onSaved: () => void;
}

export function SourceSelector({
  currentSourceTag,
  currentTrafficSourceId,
  trackingLinkId,
  onSaved,
}: SourceSelectorProps) {
  const queryClient = useQueryClient();
  const [sourceName, setSourceName] = useState(currentSourceTag || "");
  const [saving, setSaving] = useState(false);

  const { data: sources = [] } = useQuery({
    queryKey: ["traffic_sources"],
    queryFn: async () => {
      const { data } = await supabase
        .from("traffic_sources")
        .select("id, name")
        .order("name");
      return data || [];
    },
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["traffic_sources"] });
    queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
  };

  const handleSave = async () => {
    if (!sourceName.trim()) return;
    setSaving(true);
    try {
      const name = sourceName.trim();
      const existing = sources.find((s: any) => s.name === name);
      let sourceId: string;

      if (existing) {
        sourceId = existing.id;
      } else {
        const { data, error } = await supabase
          .from("traffic_sources")
          .insert({ name })
          .select("id")
          .single();
        if (error) throw error;
        sourceId = data.id;
      }

      const { error } = await supabase
        .from("tracking_links")
        .update({
          source_tag: name,
          traffic_source_id: sourceId,
          manually_tagged: true,
          traffic_category: "Manual",
        })
        .eq("id", trackingLinkId);
      if (error) throw error;

      toast.success("Saved");
      invalidateAll();
      onSaved();
    } catch {
      toast.error("Failed to save source");
    }
    setSaving(false);
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("tracking_links")
        .update({
          source_tag: null,
          traffic_source_id: null,
          manually_tagged: false,
        })
        .eq("id", trackingLinkId);
      if (error) throw error;
      setSourceName("");
      toast.success("Cleared");
      invalidateAll();
      onSaved();
    } catch {
      toast.error("Failed to clear source");
    }
    setSaving(false);
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Source List
        </span>
        <Select
          value=""
          onValueChange={(val) => setSourceName(val)}
        >
          <SelectTrigger className="h-8 text-xs bg-card border-border">
            <SelectValue placeholder="Select source..." />
          </SelectTrigger>
          <SelectContent>
            {sources.map((s: any) => (
              <SelectItem key={s.id} value={s.name} className="text-xs">
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Source Name
        </span>
        <Input
          value={sourceName}
          onChange={(e) => setSourceName(e.target.value)}
          placeholder="Type or select a source..."
          className="h-8 text-xs bg-card border-border"
        />
      </div>

      <Button
        size="sm"
        className="w-full h-8 text-xs"
        onClick={handleSave}
        disabled={!sourceName.trim() || saving}
      >
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
      </Button>

      <button
        onClick={handleClear}
        disabled={saving}
        className="w-full text-center text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
      >
        Clear selection
      </button>
    </div>
  );
}
