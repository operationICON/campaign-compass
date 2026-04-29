import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Link2, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { createTrackingLink, getTrafficSources, createTrafficSource } from "@/lib/api";
import { fetchAccounts } from "@/lib/supabase-helpers";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const COST_TYPES = ["Free", "CPC", "CPL", "Flat"] as const;
type CostType = typeof COST_TYPES[number];

interface Props {
  onClose: () => void;
}

export function AddTrackingLinkPanel({ onClose }: Props) {
  const queryClient = useQueryClient();

  const [url, setUrl] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [trafficSourceId, setTrafficSourceId] = useState("");
  const [costType, setCostType] = useState<CostType>("Free");
  const [costValue, setCostValue] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [showNewSource, setShowNewSource] = useState(false);
  const [newSourceName, setNewSourceName] = useState("");
  const [creatingSource, setCreatingSource] = useState(false);

  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const { data: trafficSources = [], refetch: refetchSources } = useQuery({ queryKey: ["traffic_sources"], queryFn: getTrafficSources });

  const activeAccounts = (accounts as any[]).filter((a: any) => a.is_active !== false);

  const mutation = useMutation({
    mutationFn: (body: Record<string, any>) => createTrackingLink(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
      toast.success("Tracking link added — will connect to OFAPI data on next sync");
      onClose();
    },
    onError: (err: any) => toast.error(`Failed: ${err.message}`),
  });

  async function handleCreateSource() {
    const trimmed = newSourceName.trim();
    if (!trimmed) return;
    const exists = (trafficSources as any[]).find((t: any) => t.name.toLowerCase() === trimmed.toLowerCase());
    if (exists) {
      setTrafficSourceId(exists.id);
      setShowNewSource(false);
      toast.info(`"${trimmed}" already exists — selected`);
      return;
    }
    setCreatingSource(true);
    try {
      const data = await createTrafficSource({ name: trimmed, category: "Manual", color: "#3b82f6", keywords: [] });
      await queryClient.invalidateQueries({ queryKey: ["traffic_sources"] });
      setTrafficSourceId(data.id);
      setNewSourceName("");
      setShowNewSource(false);
      toast.success(`Source "${trimmed}" created`);
    } catch { toast.error("Failed to create source"); }
    setCreatingSource(false);
  }

  function validate() {
    const e: Record<string, string> = {};
    if (!url.trim()) e.url = "URL is required";
    else if (!url.toLowerCase().includes("onlyfans.com")) e.url = "URL must contain onlyfans.com";
    if (!campaignName.trim()) e.campaignName = "Campaign name is required";
    if (!accountId) e.accountId = "Model is required";
    return e;
  }

  function handleSubmit() {
    const e = validate();
    if (Object.keys(e).length > 0) { setErrors(e); return; }
    setErrors({});

    const selectedSource = (trafficSources as any[]).find((t: any) => t.id === trafficSourceId);

    const body: Record<string, any> = {
      url: url.trim(),
      campaign_name: campaignName.trim(),
      account_id: accountId,
      manually_tagged: true,
      traffic_category: "Manual",
    };
    if (trafficSourceId) {
      body.traffic_source_id = trafficSourceId;
      if (selectedSource) body.source_tag = selectedSource.name;
    }
    if (costType !== "Free") {
      body.cost_type = costType;
      if (costValue) body.cost_value = parseFloat(costValue);
    }
    if (notes.trim()) body.notes = notes.trim();

    mutation.mutate(body);
  }

  const showCostValue = costType !== "Free";

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative flex flex-col bg-card border-l border-border w-full max-w-[420px] h-full shadow-2xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">Add Tracking Link</span>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-secondary transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 px-6 py-5 space-y-5">
          {/* URL */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              OF URL <span className="text-destructive">*</span>
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => { setUrl(e.target.value); setErrors(prev => ({ ...prev, url: "" })); }}
              placeholder="https://onlyfans.com/action/..."
              className={`w-full bg-secondary border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-colors ${errors.url ? "border-destructive" : "border-border"}`}
            />
            {errors.url && <p className="text-xs text-destructive">{errors.url}</p>}
          </div>

          {/* Campaign Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Campaign Name <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={campaignName}
              onChange={(e) => { setCampaignName(e.target.value); setErrors(prev => ({ ...prev, campaignName: "" })); }}
              placeholder="e.g. TikTok June Launch"
              className={`w-full bg-secondary border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-colors ${errors.campaignName ? "border-destructive" : "border-border"}`}
            />
            {errors.campaignName && <p className="text-xs text-destructive">{errors.campaignName}</p>}
          </div>

          {/* Model */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Model <span className="text-destructive">*</span>
            </label>
            <Select value={accountId} onValueChange={(v) => { setAccountId(v); setErrors(prev => ({ ...prev, accountId: "" })); }}>
              <SelectTrigger className={`w-full bg-secondary ${errors.accountId ? "border-destructive" : "border-border"}`}>
                <SelectValue placeholder="Select model..." />
              </SelectTrigger>
              <SelectContent>
                {activeAccounts.map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>{a.display_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.accountId && <p className="text-xs text-destructive">{errors.accountId}</p>}
          </div>

          {/* Traffic Source */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Traffic Source</label>
            <div className="flex gap-1.5">
              <Select value={trafficSourceId || "__none__"} onValueChange={(v) => setTrafficSourceId(v === "__none__" ? "" : v)}>
                <SelectTrigger className="flex-1 bg-secondary border-border">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {(trafficSources as any[]).filter((ts: any) => !ts.is_archived).map((ts: any) => (
                    <SelectItem key={ts.id} value={ts.id}>{ts.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button
                type="button"
                onClick={() => { setShowNewSource(v => !v); setNewSourceName(""); }}
                className="h-10 w-10 flex items-center justify-center rounded-lg border border-border bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                title="Create new source"
              >
                {showNewSource ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              </button>
            </div>
            {showNewSource && (
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={newSourceName}
                  onChange={(e) => setNewSourceName(e.target.value)}
                  placeholder="New source name..."
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") handleCreateSource(); if (e.key === "Escape") setShowNewSource(false); }}
                  className="flex-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-colors"
                />
                <button
                  onClick={handleCreateSource}
                  disabled={!newSourceName.trim() || creatingSource}
                  className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors shrink-0"
                >
                  {creatingSource ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                </button>
              </div>
            )}
          </div>

          {/* Cost Type */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Cost Type</label>
            <div className="flex gap-2">
              {COST_TYPES.map((ct) => (
                <button
                  key={ct}
                  type="button"
                  onClick={() => setCostType(ct)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    costType === ct
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-secondary text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                  }`}
                >
                  {ct}
                </button>
              ))}
            </div>
          </div>

          {/* Cost Value */}
          {showCostValue && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {costType === "CPC" ? "Cost per Click ($)" : costType === "CPL" ? "Cost per Lead ($)" : "Flat Cost ($)"}
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={costValue}
                onChange={(e) => setCostValue(e.target.value)}
                placeholder="0.00"
                className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-colors"
              />
            </div>
          )}

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add notes, paste reference links, context..."
              rows={3}
              className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-colors resize-none"
            />
          </div>

          <p className="text-xs text-muted-foreground bg-secondary/50 rounded-lg px-3 py-2 leading-relaxed">
            This link will appear immediately with <span className="text-blue-400 font-medium">MANUAL</span> status. On the next sync, it will automatically connect to OFAPI data if the URL matches.
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex gap-3 shrink-0">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-secondary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={mutation.isPending}
            className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {mutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {mutation.isPending ? "Adding..." : "Add Link"}
          </button>
        </div>
      </div>
    </div>
  );
}
