import { useState } from "react";
import { X } from "lucide-react";

interface AdSpendSlideInProps {
  link: any;
  onClose: () => void;
  onSubmit: (data: any) => void;
}

const PLATFORMS = ["Reddit", "Instagram", "Twitter", "Google", "TikTok", "Other"];

export function AdSpendSlideIn({ link, onClose, onSubmit }: AdSpendSlideInProps) {
  const [amount, setAmount] = useState("");
  const [mediaBuyer, setMediaBuyer] = useState("");
  const [platform, setPlatform] = useState(link.source || "");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    const num = parseFloat(amount);
    if (isNaN(num) || num <= 0) return;
    setSaving(true);
    await onSubmit({
      campaign_id: link.campaign_id,
      traffic_source: platform || "direct",
      amount: num,
      date,
      notes: notes || undefined,
      media_buyer: mediaBuyer || undefined,
    });
    setSaving(false);
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-[400px] bg-card border-l border-border z-50 animate-slide-in-right overflow-y-auto">
        <div className="p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-foreground">Add Ad Spend</h2>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Campaign</label>
            <div className="bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm text-foreground">
              {link.campaign_name || "Unknown"}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Media Buyer</label>
            <input
              type="text"
              value={mediaBuyer}
              onChange={(e) => setMediaBuyer(e.target.value)}
              placeholder="Enter buyer name"
              className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Platform</label>
            <div className="grid grid-cols-3 gap-1.5">
              {PLATFORMS.map(p => (
                <button
                  key={p}
                  onClick={() => setPlatform(p.toLowerCase())}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors border ${
                    platform.toLowerCase() === p.toLowerCase()
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-secondary text-muted-foreground border-border hover:text-foreground"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Amount ($)</label>
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary font-mono"
              autoFocus
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes..."
              rows={3}
              className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary resize-none"
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={saving || !amount}
            className="w-full px-4 py-3 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Ad Spend"}
          </button>
        </div>
      </div>
    </>
  );
}
