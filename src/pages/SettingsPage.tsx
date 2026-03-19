import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { fetchSyncSettings, updateSyncSetting } from "@/lib/supabase-helpers";
import { toast } from "sonner";

const FREQUENCY_OPTIONS = [
  { label: "Every 3 days", value: "3" },
  { label: "Weekly", value: "7" },
  { label: "Every 14 days", value: "14" },
  { label: "Monthly", value: "30" },
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

  return (
    <DashboardLayout>
      <div className="space-y-5 max-w-xl">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground">Configure sync schedule and preferences</p>
        </div>

        <div className="bg-card border border-border rounded-[10px] p-6 space-y-5">
          <div>
            <h2 className="text-sm font-semibold text-foreground mb-1">Auto-Sync Frequency</h2>
            <p className="text-xs text-muted-foreground mb-4">
              How often the system automatically syncs data from the API. A cron job runs at the configured interval.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {FREQUENCY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setFrequency(opt.value)}
                  className={`px-4 py-2.5 rounded-[6px] text-sm font-medium transition-colors border ${
                    frequency === opt.value
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-secondary text-muted-foreground border-border hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-[6px] bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </div>
    </DashboardLayout>
  );
}
