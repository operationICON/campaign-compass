import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { fetchSyncSettings, updateSyncSetting } from "@/lib/supabase-helpers";
import { toast } from "sonner";
import { Settings, Clock, CreditCard } from "lucide-react";

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
      <div className="space-y-5 max-w-2xl">
        <div className="flex items-center gap-3">
          <Settings className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-xl font-bold text-foreground">Settings</h1>
            <p className="text-sm text-muted-foreground">Configure sync schedule and preferences</p>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-6 space-y-6">
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
                <button
                  key={opt.value}
                  onClick={() => setFrequency(opt.value)}
                  className={`p-4 rounded-lg border text-left transition-all duration-200 ${
                    frequency === opt.value
                      ? "bg-primary/10 border-primary ring-2 ring-primary/30"
                      : "bg-secondary border-border hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                      frequency === opt.value ? "border-primary" : "border-muted-foreground"
                    }`}>
                      {frequency === opt.value && <div className="w-2 h-2 rounded-full bg-primary" />}
                    </div>
                    <span className={`text-sm font-semibold ${frequency === opt.value ? "text-foreground" : "text-muted-foreground"}`}>
                      {opt.label}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2 ml-6">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Estimated Credit Usage */}
          {selectedOpt && (
            <div className="bg-secondary/50 border border-border rounded-lg p-4 flex items-center gap-3">
              <CreditCard className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm text-foreground font-medium">Estimated usage: {selectedOpt.credits}/month</p>
                <p className="text-xs text-muted-foreground">{selectedOpt.desc}</p>
              </div>
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </div>
    </DashboardLayout>
  );
}
