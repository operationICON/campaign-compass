import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getTrafficSources, bulkSetSourceTag, bulkUpdateTrackingLinks } from "@/lib/api";
import { toast } from "sonner";
import { X } from "lucide-react";

type BulkAction = "assign_source" | "remove_source" | "set_spend" | "clear_spend" | "delete" | "restore";

interface BulkActionToolbarProps {
  selectedIds: Set<string>;
  onClear: () => void;
  totalFiltered: number;
  onSelectAll?: () => void;
  actions: BulkAction[];
  onComplete: () => void;
}

export function BulkActionToolbar({
  selectedIds,
  onClear,
  totalFiltered,
  onSelectAll,
  actions,
  onComplete,
}: BulkActionToolbarProps) {
  const queryClient = useQueryClient();
  const [sourceDropdownOpen, setSourceDropdownOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<BulkAction | null>(null);
  const [processing, setProcessing] = useState(false);

  const { data: sources = [] } = useQuery({
    queryKey: ["traffic_sources"],
    queryFn: getTrafficSources,
    enabled: actions.includes("assign_source"),
  });

  const count = selectedIds.size;
  const ids = Array.from(selectedIds);

  const handleAssignSource = async (source: any) => {
    setProcessing(true);
    try {
      await bulkUpdateTrackingLinks(ids.map(id => ({ id, source_tag: source.name, traffic_source_id: source.id, manually_tagged: true })));
      toast.success(`Source assigned to ${count} tracking links`);
      setSourceDropdownOpen(false);
      onComplete();
      onClear();
    } catch (err: any) {
      toast.error("Failed to assign source");
    } finally {
      setProcessing(false);
    }
  };

  const handleRemoveSource = async () => {
    setProcessing(true);
    try {
      await bulkUpdateTrackingLinks(ids.map(id => ({ id, source_tag: null, traffic_source_id: null, manually_tagged: false })));
      toast.success(`Source removed from ${count} tracking links`);
      setConfirmAction(null);
      onComplete();
      onClear();
    } catch (err: any) {
      toast.error("Failed to remove source");
    } finally {
      setProcessing(false);
    }
  };

  const handleDelete = async () => {
    setProcessing(true);
    try {
      await bulkUpdateTrackingLinks(ids.map(id => ({ id, deleted_at: new Date().toISOString() })));
      toast.success(`${count} tracking links deleted`);
      setConfirmAction(null);
      onComplete();
      onClear();
    } catch (err: any) {
      toast.error("Failed to delete tracking links");
    } finally {
      setProcessing(false);
    }
  };

  const handleRestore = async () => {
    setProcessing(true);
    try {
      await bulkUpdateTrackingLinks(ids.map(id => ({ id, deleted_at: null })));
      toast.success(`${count} tracking links restored`);
      setConfirmAction(null);
      onComplete();
      onClear();
    } catch (err: any) {
      toast.error("Failed to restore");
    } finally {
      setProcessing(false);
    }
  };

  if (count === 0) return null;

  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 border-b border-border animate-fade-in"
      style={{ backgroundColor: "#1a3a4a" }}
    >
      <span className="text-xs font-medium text-white">{count} selected</span>
      {count < totalFiltered && onSelectAll && (
        <button onClick={onSelectAll} className="text-[11px] text-primary underline">
          Select all {totalFiltered}
        </button>
      )}

      <div className="flex items-center gap-2 ml-2">
        {actions.includes("assign_source") && (
          <div className="relative">
            <button
              onClick={() => setSourceDropdownOpen(!sourceDropdownOpen)}
              className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-[11px] font-semibold hover:bg-primary/90"
            >
              Assign Source
            </button>
            {sourceDropdownOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setSourceDropdownOpen(false)} />
                <div className="absolute left-0 top-full mt-1 z-50 w-52 bg-card border border-border rounded-lg shadow-lg py-1 max-h-48 overflow-y-auto">
                  {sources.map((s: any) => (
                    <button
                      key={s.id}
                      onClick={() => handleAssignSource(s)}
                      disabled={processing}
                      className="w-full px-3 py-1.5 text-left text-[11px] flex items-center gap-2 hover:bg-secondary/50 transition-colors text-foreground"
                    >
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color || "#0891b2" }} />
                      {s.name}
                    </button>
                  ))}
                  {sources.length === 0 && (
                    <p className="px-3 py-2 text-[11px] text-muted-foreground">No sources defined</p>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {actions.includes("remove_source") && (
          confirmAction === "remove_source" ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-white">Remove source from {count}?</span>
              <button onClick={handleRemoveSource} disabled={processing} className="px-2 py-1 rounded bg-destructive text-white text-[10px] font-bold">Yes</button>
              <button onClick={() => setConfirmAction(null)} className="px-2 py-1 rounded bg-secondary text-foreground text-[10px]">No</button>
            </div>
          ) : (
            <button onClick={() => setConfirmAction("remove_source")} className="px-3 py-1.5 rounded-md border border-white/30 text-white text-[11px] font-medium hover:bg-white/10">
              Remove Source
            </button>
          )
        )}

        {actions.includes("delete") && (
          confirmAction === "delete" ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-white">Delete {count} tracking links?</span>
              <button onClick={handleDelete} disabled={processing} className="px-2 py-1 rounded bg-destructive text-white text-[10px] font-bold">Yes</button>
              <button onClick={() => setConfirmAction(null)} className="px-2 py-1 rounded bg-secondary text-foreground text-[10px]">No</button>
            </div>
          ) : (
            <button onClick={() => setConfirmAction("delete")} className="px-3 py-1.5 rounded-md border border-destructive/50 text-destructive text-[11px] font-medium hover:bg-destructive/10">
              Delete
            </button>
          )
        )}

        {actions.includes("restore") && (
          <button onClick={handleRestore} disabled={processing} className="px-3 py-1.5 rounded-md border border-primary/50 text-primary text-[11px] font-medium hover:bg-primary/10">
            Restore
          </button>
        )}
      </div>

      <button onClick={onClear} className="ml-auto p-1 rounded hover:bg-white/10">
        <X className="h-3.5 w-3.5 text-white" />
      </button>
    </div>
  );
}
