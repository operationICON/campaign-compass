import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus } from "lucide-react";
import { addAdSpend } from "@/lib/supabase-helpers";
import { toast } from "sonner";

interface AdSpendDialogProps {
  campaigns: { id: string; name: string; traffic_source: string | null }[];
  onAdded: () => void;
}

export function AdSpendDialog({ campaigns, onAdded }: AdSpendDialogProps) {
  const [open, setOpen] = useState(false);
  const [campaignId, setCampaignId] = useState("");
  const [trafficSource, setTrafficSource] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!campaignId || !trafficSource || !amount) {
      toast.error("Please fill in all required fields");
      return;
    }
    setSaving(true);
    try {
      await addAdSpend({
        campaign_id: campaignId,
        traffic_source: trafficSource,
        amount: parseFloat(amount),
        date,
        notes: notes || undefined,
      });
      toast.success("Ad spend added");
      setOpen(false);
      setCampaignId("");
      setTrafficSource("");
      setAmount("");
      setNotes("");
      onAdded();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="h-4 w-4 mr-2" /> Add Ad Spend
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border">
        <DialogHeader>
          <DialogTitle>Add Ad Spend</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Campaign</Label>
            <Select value={campaignId} onValueChange={setCampaignId}>
              <SelectTrigger className="bg-secondary border-border"><SelectValue placeholder="Select campaign" /></SelectTrigger>
              <SelectContent>
                {campaigns.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Traffic Source</Label>
            <Input value={trafficSource} onChange={e => setTrafficSource(e.target.value)} placeholder="e.g. Reddit, TikTok" className="bg-secondary border-border" />
          </div>
          <div>
            <Label>Amount ($)</Label>
            <Input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" className="bg-secondary border-border" />
          </div>
          <div>
            <Label>Date</Label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="bg-secondary border-border" />
          </div>
          <div>
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} className="bg-secondary border-border" />
          </div>
          <Button onClick={handleSubmit} disabled={saving} className="w-full">
            {saving ? "Saving..." : "Add Spend"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
