import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  fetchSyncSettings, updateSyncSetting,
  fetchSourceTagRules, createSourceTagRule, updateSourceTagRule, deleteSourceTagRule,
  fetchTrackingLinks,
} from "@/lib/supabase-helpers";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Settings, Clock, CreditCard, Tag, Pencil, Trash2, Plus } from "lucide-react";
import { RefreshButton } from "@/components/RefreshButton";

const FREQUENCY_OPTIONS = [
  { label: "Every 3 days", value: "3", desc: "~10 syncs/month", credits: "~50 credits" },
  { label: "Weekly", value: "7", desc: "~4 syncs/month", credits: "~20 credits" },
  { label: "Every 14 days", value: "14", desc: "~2 syncs/month", credits: "~10 credits" },
  { label: "Monthly", value: "30", desc: "1 sync/month", credits: "~5 credits" },
];

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings = [] } = useQuery({ queryKey: ["sync_settings"], queryFn: fetchSyncSettings });
  const { data: tagRules = [] } = useQuery({ queryKey: ["source_tag_rules"], queryFn: fetchSourceTagRules });
  const { data: links = [] } = useQuery({ queryKey: ["tracking_links"], queryFn: () => fetchTrackingLinks() });

  const [frequency, setFrequency] = useState("3");
  const [saving, setSaving] = useState(false);

  // Tag management state
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("#0891b2");
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#0891b2");

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

  // Tag counts
  const tagCounts: Record<string, number> = {};
  links.forEach((l: any) => {
    if (l.source_tag) {
      tagCounts[l.source_tag] = (tagCounts[l.source_tag] || 0) + 1;
    }
  });

  const handleAddTag = async () => {
    if (!newTagName.trim()) return;
    try {
      await createSourceTagRule({ tag_name: newTagName.trim(), keywords: [], color: newTagColor, priority: 0 });
      queryClient.invalidateQueries({ queryKey: ["source_tag_rules"] });
      toast.success("Tag added");
      setNewTagName("");
      setNewTagColor("#0891b2");
      setShowAddForm(false);
    } catch (err: any) { toast.error(err.message); }
  };

  const handleEditTag = async (id: string) => {
    if (!editName.trim()) return;
    try {
      await updateSourceTagRule(id, { tag_name: editName.trim(), color: editColor });
      queryClient.invalidateQueries({ queryKey: ["source_tag_rules"] });
      toast.success("Tag updated");
      setEditingTag(null);
    } catch (err: any) { toast.error(err.message); }
  };

  const handleDeleteTag = async (id: string, tagName: string) => {
    try {
      // Clear source_tag on tracking_links using this tag
      await supabase.from("tracking_links").update({ source_tag: null, manually_tagged: false } as any).eq("source_tag", tagName);
      await deleteSourceTagRule(id);
      queryClient.invalidateQueries({ queryKey: ["source_tag_rules"] });
      queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
      toast.success("Tag deleted");
    } catch (err: any) { toast.error(err.message); }
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
              <p className="text-sm text-muted-foreground">Configure sync schedule and source tags</p>
            </div>
          </div>
          <RefreshButton queryKeys={["sync_settings", "source_tag_rules"]} />
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

        {/* Source Tags */}
        <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Tag className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-bold text-foreground">Source Tags</h2>
              </div>
              <p className="text-xs text-muted-foreground">Tags are assigned manually from the campaign detail row.</p>
            </div>
            <button onClick={() => setShowAddForm(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors">
              <Plus className="h-3.5 w-3.5" /> Add Tag
            </button>
          </div>

          {showAddForm && (
            <div className="flex items-center gap-3 p-3 bg-secondary/50 border border-border rounded-xl">
              <input type="text" value={newTagName} onChange={(e) => setNewTagName(e.target.value)}
                placeholder="Tag name..." className="flex-1 px-2.5 py-1.5 bg-card border border-border rounded-md text-sm text-foreground outline-none focus:ring-1 focus:ring-primary" />
              <input type="color" value={newTagColor} onChange={(e) => setNewTagColor(e.target.value)}
                className="w-8 h-8 rounded border border-border cursor-pointer" />
              <button onClick={handleAddTag} className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold">Save</button>
              <button onClick={() => { setShowAddForm(false); setNewTagName(""); }} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-secondary/50 border-b border-border">
                  <th className="text-left px-4 py-2.5 text-[10px] font-medium text-muted-foreground uppercase" style={{ letterSpacing: "0.05em" }}>Tag Name</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-medium text-muted-foreground uppercase" style={{ letterSpacing: "0.05em" }}>Color</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-medium text-muted-foreground uppercase" style={{ letterSpacing: "0.05em" }}>Tagged</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-medium text-muted-foreground uppercase" style={{ letterSpacing: "0.05em" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {tagRules.map((rule: any) => (
                  <tr key={rule.id} className="border-b border-border/50 hover:bg-secondary/20 transition-colors">
                    {editingTag === rule.id ? (
                      <>
                        <td className="px-4 py-2">
                          <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
                            className="px-2 py-1 bg-card border border-border rounded text-sm text-foreground outline-none focus:ring-1 focus:ring-primary w-full" />
                        </td>
                        <td className="px-4 py-2">
                          <input type="color" value={editColor} onChange={(e) => setEditColor(e.target.value)}
                            className="w-7 h-7 rounded border border-border cursor-pointer" />
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">{tagCounts[rule.tag_name] || 0}</td>
                        <td className="px-4 py-2 text-right">
                          <button onClick={() => handleEditTag(rule.id)} className="text-xs text-primary font-semibold mr-2">Save</button>
                          <button onClick={() => setEditingTag(null)} className="text-xs text-muted-foreground">Cancel</button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: rule.color }} />
                            <span className="text-sm font-medium text-foreground">{rule.tag_name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2">
                          <span className="inline-block w-6 h-6 rounded border border-border" style={{ backgroundColor: rule.color }} />
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground font-mono">{tagCounts[rule.tag_name] || 0}</td>
                        <td className="px-4 py-2 text-right">
                          <button onClick={() => { setEditingTag(rule.id); setEditName(rule.tag_name); setEditColor(rule.color); }}
                            className="p-1 text-muted-foreground hover:text-foreground mr-1"><Pencil className="h-3.5 w-3.5" /></button>
                          <button onClick={() => handleDeleteTag(rule.id, rule.tag_name)}
                            className="p-1 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
                {tagRules.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">No source tags configured. Click "Add Tag" to create one.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
