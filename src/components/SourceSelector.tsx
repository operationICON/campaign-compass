import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pencil, Trash2, Plus, Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";

interface SourceSelectorProps {
  currentSourceTag: string | null;
  currentTrafficSourceId: string | null;
  trackingLinkId: string;
  onSaved: () => void;
  /** Settings mode: show campaign_count, no save-to-tracking-link */
  settingsMode?: boolean;
}

export function SourceSelector({
  currentSourceTag,
  currentTrafficSourceId,
  trackingLinkId,
  onSaved,
  settingsMode = false,
}: SourceSelectorProps) {
  const queryClient = useQueryClient();

  const { data: sources = [] } = useQuery({
    queryKey: ["traffic_sources"],
    queryFn: async () => {
      const { data } = await supabase
        .from("traffic_sources")
        .select("id, name, campaign_count")
        .order("name");
      return data || [];
    },
  });

  const [selectedName, setSelectedName] = useState<string | null>(currentSourceTag);
  const [selectedId, setSelectedId] = useState<string | null>(currentTrafficSourceId);
  const [saving, setSaving] = useState(false);

  // UI modes
  const [editingSource, setEditingSource] = useState<any>(null);
  const [deletingSource, setDeletingSource] = useState<any>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [inputName, setInputName] = useState("");

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["traffic_sources"] });
    queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
  };

  const handleSelect = (source: any | null) => {
    if (source) {
      setSelectedName(source.name);
      setSelectedId(source.id);
    } else {
      setSelectedName(null);
      setSelectedId(null);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("tracking_links")
        .update({
          source_tag: selectedName || null,
          traffic_source_id: selectedId || null,
          manually_tagged: true,
        })
        .eq("id", trackingLinkId);
      if (error) throw error;
      toast.success("Source saved");
      invalidateAll();
      onSaved();
    } catch {
      toast.error("Failed to save source");
    }
    setSaving(false);
  };

  const handleCreate = async () => {
    if (!inputName.trim()) return;
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from("traffic_sources")
        .insert({ name: inputName.trim() })
        .select()
        .single();
      if (error) throw error;
      setSelectedName(data.name);
      setSelectedId(data.id);
      toast.success("Source created");
      invalidateAll();
      setAddingNew(false);
      setInputName("");
    } catch {
      toast.error("Failed to create source");
    }
    setSaving(false);
  };

  const handleUpdate = async () => {
    if (!inputName.trim() || !editingSource) return;
    setSaving(true);
    try {
      const oldName = editingSource.name;
      const newName = inputName.trim();
      const { error } = await supabase
        .from("traffic_sources")
        .update({ name: newName })
        .eq("id", editingSource.id);
      if (error) throw error;
      if (oldName !== newName) {
        await supabase
          .from("tracking_links")
          .update({ source_tag: newName })
          .eq("source_tag", oldName);
      }
      if (selectedId === editingSource.id) {
        setSelectedName(newName);
      }
      toast.success("Source updated");
      invalidateAll();
      setEditingSource(null);
      setInputName("");
    } catch {
      toast.error("Failed to update source");
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deletingSource) return;
    setSaving(true);
    try {
      await supabase
        .from("tracking_links")
        .update({ source_tag: null, traffic_source_id: null })
        .eq("traffic_source_id", deletingSource.id);
      const { error } = await supabase
        .from("traffic_sources")
        .delete()
        .eq("id", deletingSource.id);
      if (error) throw error;
      if (selectedId === deletingSource.id) {
        setSelectedName(null);
        setSelectedId(null);
      }
      toast.success("Source deleted");
      invalidateAll();
      setDeletingSource(null);
    } catch {
      toast.error("Failed to delete source");
    }
    setSaving(false);
  };

  // Delete confirmation
  if (deletingSource) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-destructive font-medium">
          Delete "{deletingSource.name}"? All campaigns using this source will become Untagged.
        </p>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="destructive"
            className="flex-1 h-8 text-xs"
            onClick={handleDelete}
            disabled={saving}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Confirm Delete"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={() => setDeletingSource(null)}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  // Edit form
  if (editingSource) {
    return (
      <div className="space-y-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Edit Source
        </span>
        <Input
          type="text"
          value={inputName}
          onChange={(e) => setInputName(e.target.value)}
          placeholder="Source name..."
          className="h-8 text-sm bg-card border-border"
          autoFocus
        />
        <div className="flex gap-1.5">
          <Button
            size="sm"
            className="flex-1 h-8 text-xs"
            onClick={handleUpdate}
            disabled={!inputName.trim() || saving}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Update"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={() => {
              setEditingSource(null);
              setInputName("");
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  // Add new form
  if (addingNew) {
    return (
      <div className="space-y-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          New Source
        </span>
        <Input
          type="text"
          value={inputName}
          onChange={(e) => setInputName(e.target.value)}
          placeholder="Source name..."
          className="h-8 text-sm bg-card border-border"
          autoFocus
        />
        <div className="flex gap-1.5">
          <Button
            size="sm"
            className="flex-1 h-8 text-xs"
            onClick={handleCreate}
            disabled={!inputName.trim() || saving}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Create"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={() => {
              setAddingNew(false);
              setInputName("");
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  // Default state
  return (
    <div className="space-y-2">
      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        Source
      </span>

      {/* Current source */}
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-muted-foreground shrink-0" />
        {selectedName ? (
          <span className="text-xs font-bold text-foreground">{selectedName}</span>
        ) : (
          <span className="text-xs italic text-muted-foreground">Untagged</span>
        )}
      </div>

      {/* Source list */}
      <ScrollArea className="max-h-[180px] border border-border rounded-md">
        <div className="divide-y divide-border">
          {/* Untagged row */}
          <button
            onClick={() => handleSelect(null)}
            className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors ${
              !selectedName
                ? "bg-primary/10 text-foreground font-semibold"
                : "text-muted-foreground hover:bg-muted/50"
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-muted-foreground shrink-0" />
            <span className="flex-1">— Untagged —</span>
            {!selectedName && <Check className="h-3 w-3 text-primary" />}
          </button>

          {/* Existing sources */}
          {sources.map((s: any) => (
            <div
              key={s.id}
              className={`flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                selectedId === s.id
                  ? "bg-primary/10 text-foreground font-semibold"
                  : "text-foreground hover:bg-muted/50"
              }`}
            >
              <button
                onClick={() => handleSelect(s)}
                className="flex items-center gap-2 flex-1 min-w-0 text-left"
              >
                <span className="w-2 h-2 rounded-full bg-muted-foreground shrink-0" />
                <span className="truncate flex-1">{s.name}</span>
                {settingsMode && (
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {s.campaign_count ?? 0} campaigns
                  </span>
                )}
                {selectedId === s.id && <Check className="h-3 w-3 text-primary shrink-0" />}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingSource(s);
                  setInputName(s.name);
                }}
                className="text-muted-foreground hover:text-foreground p-0.5 transition-colors shrink-0"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDeletingSource(s);
                }}
                className="text-muted-foreground hover:text-destructive p-0.5 transition-colors shrink-0"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}

          {/* Add new row */}
          <button
            onClick={() => {
              setAddingNew(true);
              setInputName("");
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-primary hover:bg-muted/50 transition-colors"
          >
            <Plus className="h-3 w-3" />
            <span>Add new source</span>
          </button>
        </div>
      </ScrollArea>

      {/* Save button (not in settings mode) */}
      {!settingsMode && (
        <Button
          size="sm"
          className="w-full h-8 text-xs"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
        </Button>
      )}
    </div>
  );
}
