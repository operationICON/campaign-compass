import { useState, useEffect } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  fetchSyncSettings, updateSyncSetting, fetchSourceTagRules,
  createSourceTagRule, updateSourceTagRule, deleteSourceTagRule, runAutoTag
} from "@/lib/supabase-helpers";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Settings, Clock, CreditCard, Tag, Plus, Pencil, X, Wand2, GripVertical, ChevronDown, ChevronUp } from "lucide-react";

const FREQUENCY_OPTIONS = [
  { label: "Every 3 days", value: "3", desc: "~10 syncs/month", credits: "~50 credits" },
  { label: "Weekly", value: "7", desc: "~4 syncs/month", credits: "~20 credits" },
  { label: "Every 14 days", value: "14", desc: "~2 syncs/month", credits: "~10 credits" },
  { label: "Monthly", value: "30", desc: "1 sync/month", credits: "~5 credits" },
];

const PRESET_COLORS = ["#0891b2", "#16a34a", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

const NAMING_EXAMPLES = [
  { name: "reddit 12.02.26", tag: "Reddit" },
  { name: "OnlyFinder 5.0", tag: "OnlyFinder" },
  { name: "instagram 13.12.25", tag: "Instagram" },
  { name: "SEO 01.10.25", tag: "SEO" },
  { name: "Juicy - New", tag: "Juicy" },
  { name: 'Creator traffic (1.ads)', tag: "Creator Traffic" },
];

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings = [] } = useQuery({ queryKey: ["sync_settings"], queryFn: fetchSyncSettings });
  const { data: rules = [] } = useQuery({ queryKey: ["source_tag_rules"], queryFn: fetchSourceTagRules });
  const [frequency, setFrequency] = useState("3");
  const [saving, setSaving] = useState(false);

  // Tag rule form state
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [editingRule, setEditingRule] = useState<any>(null);
  const [ruleTagName, setRuleTagName] = useState("");
  const [ruleKeywords, setRuleKeywords] = useState("");
  const [ruleColor, setRuleColor] = useState("#0891b2");
  const [tipsOpen, setTipsOpen] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Tag counts from tracking_links
  const { data: tagCounts = {} } = useQuery({
    queryKey: ["tag_counts"],
    queryFn: async () => {
      const { data } = await supabase.from("tracking_links").select("source_tag");
      const counts: Record<string, number> = {};
      (data || []).forEach((l: any) => {
        const tag = l.source_tag || "Untagged";
        counts[tag] = (counts[tag] || 0) + 1;
      });
      return counts;
    },
  });

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

  const autoTagMutation = useMutation({
    mutationFn: runAutoTag,
    onSuccess: (data: any) => {
      toast.success(`Auto-tagged ${data.tagged} campaigns. ${data.untagged} remain untagged.`);
      queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
      queryClient.invalidateQueries({ queryKey: ["tag_counts"] });
    },
    onError: (err: any) => toast.error(`Auto-tag failed: ${err.message}`),
  });

  const openAddRule = () => {
    setEditingRule(null);
    setRuleTagName("");
    setRuleKeywords("");
    setRuleColor("#0891b2");
    setShowRuleForm(true);
  };

  const openEditRule = (rule: any) => {
    setEditingRule(rule);
    setRuleTagName(rule.tag_name);
    setRuleKeywords((rule.keywords || []).join(", "));
    setRuleColor(rule.color || "#0891b2");
    setShowRuleForm(true);
  };

  const handleSaveRule = async () => {
    if (!ruleTagName.trim()) { toast.error("Tag name is required"); return; }
    const keywords = ruleKeywords.split(",").map((k: string) => k.trim()).filter(Boolean);
    if (keywords.length === 0) { toast.error("At least one keyword is required"); return; }

    try {
      if (editingRule) {
        await updateSourceTagRule(editingRule.id, { tag_name: ruleTagName, keywords, color: ruleColor });
        toast.success("Rule updated");
      } else {
        const maxPriority = rules.length > 0 ? Math.max(...rules.map((r: any) => r.priority || 0)) : 0;
        await createSourceTagRule({ tag_name: ruleTagName, keywords, color: ruleColor, priority: maxPriority + 1 });
        toast.success("Rule added");
      }
      queryClient.invalidateQueries({ queryKey: ["source_tag_rules"] });
      setShowRuleForm(false);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleDeleteRule = async (rule: any) => {
    try {
      // Reset tracking links using this tag
      await supabase.from("tracking_links").update({ source_tag: null, manually_tagged: false } as any).eq("source_tag", rule.tag_name);
      await deleteSourceTagRule(rule.id);
      toast.success(`Deleted "${rule.tag_name}" rule`);
      queryClient.invalidateQueries({ queryKey: ["source_tag_rules"] });
      queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
      queryClient.invalidateQueries({ queryKey: ["tag_counts"] });
      setDeleteConfirmId(null);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleMovePriority = async (rule: any, direction: "up" | "down") => {
    const idx = rules.findIndex((r: any) => r.id === rule.id);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= rules.length) return;
    const other = rules[swapIdx];
    try {
      await updateSourceTagRule(rule.id, { priority: other.priority });
      await updateSourceTagRule(other.id, { priority: rule.priority });
      queryClient.invalidateQueries({ queryKey: ["source_tag_rules"] });
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const selectedOpt = FREQUENCY_OPTIONS.find(o => o.value === frequency);

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-4xl">
        <div className="flex items-center gap-3">
          <Settings className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-xl font-bold text-foreground">Settings</h1>
            <p className="text-sm text-muted-foreground">Configure sync schedule and auto-tagging rules</p>
          </div>
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

        {/* Campaign Auto-Tagging Rules */}
        <div className="bg-card border border-border rounded-2xl p-6 space-y-5">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Tag className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-bold text-foreground">Campaign Auto-Tagging Rules</h2>
              </div>
              <p className="text-xs text-muted-foreground max-w-lg">
                These rules automatically tag your tracking links based on campaign name keywords. Rules are checked in priority order — first match wins. Manually tagged campaigns are never overwritten.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => autoTagMutation.mutate(undefined)} disabled={autoTagMutation.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-primary/30 text-primary text-sm font-medium hover:bg-primary/10 transition-colors disabled:opacity-50">
                <Wand2 className={`h-3.5 w-3.5 ${autoTagMutation.isPending ? "animate-spin" : ""}`} />
                {autoTagMutation.isPending ? "Scanning..." : "Run Auto-Tag"}
              </button>
              <button onClick={openAddRule}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg gradient-bg text-white text-sm font-medium hover:opacity-90 transition-colors">
                <Plus className="h-3.5 w-3.5" /> Add Rule
              </button>
            </div>
          </div>

          {/* Add/Edit Rule Form */}
          {showRuleForm && (
            <div className="bg-secondary/50 border border-border rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-semibold text-foreground">{editingRule ? "Edit Rule" : "Add New Rule"}</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground font-medium mb-1 block">Tag Name</label>
                  <input type="text" value={ruleTagName} onChange={(e) => setRuleTagName(e.target.value)} placeholder="e.g. OnlyFinder"
                    className="w-full px-3 py-2 bg-card border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-medium mb-1 block">Keywords (comma separated)</label>
                  <input type="text" value={ruleKeywords} onChange={(e) => setRuleKeywords(e.target.value)} placeholder="e.g. reddit, redd, r/"
                    className="w-full px-3 py-2 bg-card border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary" />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1 block">Color</label>
                <div className="flex items-center gap-2">
                  {PRESET_COLORS.map((c) => (
                    <button key={c} onClick={() => setRuleColor(c)}
                      className={`w-7 h-7 rounded-full border-2 transition-all ${ruleColor === c ? "border-foreground scale-110" : "border-transparent"}`}
                      style={{ backgroundColor: c }} />
                  ))}
                  <input type="color" value={ruleColor} onChange={(e) => setRuleColor(e.target.value)}
                    className="w-7 h-7 rounded border-0 cursor-pointer" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handleSaveRule} className="px-4 py-2 rounded-lg gradient-bg text-white text-sm font-medium hover:opacity-90">Save</button>
                <button onClick={() => setShowRuleForm(false)} className="px-4 py-2 rounded-lg bg-secondary text-foreground text-sm font-medium hover:bg-secondary/80">Cancel</button>
              </div>
            </div>
          )}

          {/* Rules Table */}
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-secondary/30 border-b border-border">
                  <th className="h-9 px-3 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider w-16">Priority</th>
                  <th className="h-9 px-3 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Tag Name</th>
                  <th className="h-9 px-3 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider w-12">Color</th>
                  <th className="h-9 px-3 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Keywords</th>
                  <th className="h-9 px-3 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider w-24">Tagged</th>
                  <th className="h-9 px-3 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider w-24">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rules.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground text-sm">No rules yet. Click "Run Auto-Tag" to seed defaults, or add a rule.</td></tr>
                ) : rules.map((rule: any, idx: number) => (
                  <tr key={rule.id} className="border-b border-border hover:bg-secondary/20 transition-colors">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50" />
                        <div className="flex flex-col">
                          <button onClick={() => handleMovePriority(rule, "up")} disabled={idx === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-20 transition-colors"><ChevronUp className="h-3 w-3" /></button>
                          <button onClick={() => handleMovePriority(rule, "down")} disabled={idx === rules.length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-20 transition-colors"><ChevronDown className="h-3 w-3" /></button>
                        </div>
                        <span className="text-xs text-muted-foreground font-mono">{rule.priority}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 font-semibold text-foreground text-[13px]">{rule.tag_name}</td>
                    <td className="px-3 py-2">
                      <div className="w-5 h-5 rounded-full border border-border" style={{ backgroundColor: rule.color }} />
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-xs text-muted-foreground">{(rule.keywords || []).join(", ")}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-xs font-medium text-foreground">{tagCounts[rule.tag_name] || 0}</span>
                    </td>
                    <td className="px-3 py-2">
                      {deleteConfirmId === rule.id ? (
                        <span className="inline-flex items-center gap-1 text-[11px]">
                          <span className="text-muted-foreground">Delete?</span>
                          <button onClick={() => handleDeleteRule(rule)} className="text-destructive font-semibold hover:underline">Yes</button>
                          <button onClick={() => setDeleteConfirmId(null)} className="text-muted-foreground hover:text-foreground">Cancel</button>
                        </span>
                      ) : (
                        <div className="flex items-center gap-1">
                          <button onClick={() => openEditRule(rule)} className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"><Pencil className="h-3.5 w-3.5" /></button>
                          <button onClick={() => setDeleteConfirmId(rule.id)} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"><X className="h-3.5 w-3.5" /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Naming Convention Tips */}
          <div className="border border-border rounded-xl overflow-hidden">
            <button onClick={() => setTipsOpen(!tipsOpen)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-secondary/30 transition-colors">
              <span className="text-sm font-semibold text-foreground">Naming Convention Tips</span>
              {tipsOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </button>
            {tipsOpen && (
              <div className="px-4 pb-4 space-y-3">
                <p className="text-xs text-muted-foreground">For best results, include the traffic source name at the start of your campaign name. Examples:</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="py-1.5 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Campaign Name</th>
                      <th className="py-1.5 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Auto-tagged as</th>
                    </tr>
                  </thead>
                  <tbody>
                    {NAMING_EXAMPLES.map((ex, i) => (
                      <tr key={i} className="border-b border-border/50">
                        <td className="py-1.5 text-foreground font-mono text-[12px]">"{ex.name}"</td>
                        <td className="py-1.5">
                          <span className="text-primary font-semibold text-[12px]">{ex.tag}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-muted-foreground italic">New campaigns are auto-tagged on the next sync if they match a rule.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
