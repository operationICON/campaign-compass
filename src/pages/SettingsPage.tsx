import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { fetchSyncSettings, updateSyncSetting } from "@/lib/supabase-helpers";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Settings, Clock, CreditCard, Globe, Pencil, Trash2, Plus, Loader2 } from "lucide-react";
import { RefreshButton } from "@/components/RefreshButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const FREQUENCY_OPTIONS = [
  { label: "Every 3 days", value: "3", desc: "~10 syncs/month", credits: "~50 credits" },
  { label: "Weekly", value: "7", desc: "~4 syncs/month", credits: "~20 credits" },
  { label: "Every 14 days", value: "14", desc: "~2 syncs/month", credits: "~10 credits" },
  { label: "Monthly", value: "30", desc: "1 sync/month", credits: "~5 credits" },
];

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings = [] } = useQuery({ queryKey: ["sync_settings"], queryFn: fetchSyncSettings });

  const [frequency, setFrequency] = useState("3");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const freq = settings.find((s: any) => s.key === "sync_frequency_days");
    if (freq) setFrequency(freq.value);
  }, [settings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSyncSetting("sync_frequency_days", frequency);
      queryClient.invalidateQueries({ queryKey: ["sync_settings"] });
      toast.success("Sync frequency updated");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const selectedOpt = FREQUENCY_OPTIONS.find(o => o.value === frequency);

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-4xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Settings className="h-5 w-5 text-primary" />
            <div>
              <h1 className="text-xl font-bold text-foreground">Settings</h1>
              <p className="text-sm text-muted-foreground">Configure sync schedule</p>
            </div>
          </div>
          <RefreshButton queryKeys={["sync_settings"]} />
        </div>

        {/* Auto-Sync Frequency */}
        <div className="bg-card border border-border rounded-2xl p-6 space-y-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-bold text-foreground">Auto-Sync Frequency</h2>
            </div>
            <p className="text-xs text-muted-foreground mb-5">
              How often the system automatically syncs data from the API.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {FREQUENCY_OPTIONS.map((opt) => (
                <button key={opt.value} onClick={() => setFrequency(opt.value)}
                  className={`p-4 rounded-xl border text-left transition-all duration-200 ${
                    frequency === opt.value ? "bg-primary/10 border-primary ring-2 ring-primary/30" : "bg-secondary border-border hover:border-primary/40"
                  }`}>
                  <div className="flex items-center gap-2">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${frequency === opt.value ? "border-primary" : "border-muted-foreground"}`}>
                      {frequency === opt.value && <div className="w-2 h-2 rounded-full bg-primary" />}
                    </div>
                    <span className={`text-sm font-semibold ${frequency === opt.value ? "text-foreground" : "text-muted-foreground"}`}>{opt.label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2 ml-6">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>
          {selectedOpt && (
            <div className="bg-secondary/50 border border-border rounded-xl p-4 flex items-center gap-3">
              <CreditCard className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm text-foreground font-medium">Estimated usage: {selectedOpt.credits}/month</p>
                <p className="text-xs text-muted-foreground">{selectedOpt.desc}</p>
              </div>
            </div>
          )}
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2.5 rounded-xl gradient-bg text-white text-sm font-semibold hover:opacity-90 transition-all duration-200 disabled:opacity-50 hero-glow">
            {saving ? "Saving..." : "Save Settings"}
          </button>
        </div>

        {/* Traffic Sources */}
        <TrafficSourcesSection />
      </div>
    </DashboardLayout>
  );
}

function TrafficSourcesSection() {
  const queryClient = useQueryClient();
  const { data: sources = [], isLoading } = useQuery({
    queryKey: ["traffic_sources"],
    queryFn: async () => {
      const { data } = await supabase.from("traffic_sources").select("id, name, campaign_count").order("name");
      return data || [];
    },
  });

  const [editingSource, setEditingSource] = useState<any>(null);
  const [deletingSource, setDeletingSource] = useState<any>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [inputName, setInputName] = useState("");
  const [saving, setSaving] = useState(false);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["traffic_sources"] });
    queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
  };

  const handleCreate = async () => {
    if (!inputName.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("traffic_sources").insert({ name: inputName.trim() });
      if (error) throw error;
      toast.success("Source created");
      invalidateAll();
      setAddingNew(false);
      setInputName("");
    } catch { toast.error("Failed to create source"); }
    setSaving(false);
  };

  const handleUpdate = async () => {
    if (!inputName.trim() || !editingSource) return;
    setSaving(true);
    try {
      const oldName = editingSource.name;
      const newName = inputName.trim();
      const { error } = await supabase.from("traffic_sources").update({ name: newName }).eq("id", editingSource.id);
      if (error) throw error;
      if (oldName !== newName) {
        await supabase.from("tracking_links").update({ source_tag: newName }).eq("source_tag", oldName);
      }
      toast.success("Source updated");
      invalidateAll();
      setEditingSource(null);
      setInputName("");
    } catch { toast.error("Failed to update source"); }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deletingSource) return;
    setSaving(true);
    try {
      await supabase.from("tracking_links").update({ source_tag: null, traffic_source_id: null }).eq("traffic_source_id", deletingSource.id);
      const { error } = await supabase.from("traffic_sources").delete().eq("id", deletingSource.id);
      if (error) throw error;
      toast.success("Source deleted");
      invalidateAll();
      setDeletingSource(null);
    } catch { toast.error("Failed to delete source"); }
    setSaving(false);
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Globe className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-bold text-foreground">Traffic Sources</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Manage all traffic sources used across your campaigns
          </p>
        </div>
        <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => { setAddingNew(true); setInputName(""); }}>
          <Plus className="h-3.5 w-3.5" /> Add New Source
        </Button>
      </div>

      {/* Add new form */}
      {addingNew && (
        <div className="flex items-center gap-2 p-3 border border-border rounded-lg bg-secondary/50">
          <Input
            type="text"
            value={inputName}
            onChange={(e) => setInputName(e.target.value)}
            placeholder="Source name..."
            className="h-8 text-sm bg-card border-border flex-1"
            autoFocus
          />
          <Button size="sm" className="h-8 text-xs" onClick={handleCreate} disabled={!inputName.trim() || saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Create"}
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { setAddingNew(false); setInputName(""); }}>
            Cancel
          </Button>
        </div>
      )}

      {/* Delete confirmation */}
      {deletingSource && (
        <div className="p-3 border border-destructive/30 rounded-lg bg-destructive/5 space-y-2">
          <p className="text-xs text-destructive font-medium">
            Delete "{deletingSource.name}"? All campaigns using this source will become Untagged.
          </p>
          <div className="flex gap-1.5">
            <Button size="sm" variant="destructive" className="h-8 text-xs" onClick={handleDelete} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Confirm Delete"}
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setDeletingSource(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Source list */}
      {isLoading ? (
        <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </div>
      ) : sources.length === 0 ? (
        <p className="text-xs text-muted-foreground italic py-4">No sources yet. Click "Add New Source" to create one.</p>
      ) : (
        <div className="border border-border rounded-lg divide-y divide-border">
          {sources.map((s: any) => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-3">
              {editingSource?.id === s.id ? (
                <>
                  <span className="w-2.5 h-2.5 rounded-full bg-muted-foreground shrink-0" />
                  <Input
                    type="text"
                    value={inputName}
                    onChange={(e) => setInputName(e.target.value)}
                    className="h-8 text-sm bg-card border-border flex-1"
                    autoFocus
                  />
                  <Button size="sm" className="h-8 text-xs" onClick={handleUpdate} disabled={!inputName.trim() || saving}>
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Update"}
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { setEditingSource(null); setInputName(""); }}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <span className="w-2.5 h-2.5 rounded-full bg-muted-foreground shrink-0" />
                  <span className="text-sm text-foreground font-medium flex-1">{s.name}</span>
                  <span className="text-xs text-muted-foreground">{s.campaign_count ?? 0} campaigns</span>
                  <button
                    onClick={() => { setEditingSource(s); setInputName(s.name); }}
                    className="text-muted-foreground hover:text-foreground p-1 transition-colors"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setDeletingSource(s)}
                    className="text-muted-foreground hover:text-destructive p-1 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
