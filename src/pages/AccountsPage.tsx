import { useState } from "react";
import { format } from "date-fns";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { fetchAccounts, upsertAccount, deleteAccount } from "@/lib/supabase-helpers";
import { toast } from "sonner";

export default function AccountsPage() {
  const queryClient = useQueryClient();
  const { data: accounts = [], isLoading } = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editAccount, setEditAccount] = useState<any>(null);
  const [form, setForm] = useState({ onlyfans_account_id: "", display_name: "", is_active: true });

  const saveMutation = useMutation({
    mutationFn: (data: any) => upsertAccount(data),
    onSuccess: () => { toast.success("Account saved"); queryClient.invalidateQueries({ queryKey: ["accounts"] }); setDialogOpen(false); resetForm(); },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAccount,
    onSuccess: () => { toast.success("Account deleted"); queryClient.invalidateQueries({ queryKey: ["accounts"] }); },
    onError: (err: any) => toast.error(err.message),
  });

  const resetForm = () => { setEditAccount(null); setForm({ onlyfans_account_id: "", display_name: "", is_active: true }); };
  const openEdit = (account: any) => {
    setEditAccount(account);
    setForm({ onlyfans_account_id: account.onlyfans_account_id, display_name: account.display_name, is_active: account.is_active });
    setDialogOpen(true);
  };

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Accounts</h1>
            <p className="text-sm text-muted-foreground">OnlyFans accounts synced from API</p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
            <DialogTrigger asChild>
              <Button className="gradient-bg text-white hover:opacity-90 rounded-[10px]"><Plus className="h-4 w-4 mr-2" /> Add Account</Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border">
              <DialogHeader><DialogTitle>{editAccount ? "Edit Account" : "Add Account"}</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div><Label>OnlyFans Account ID</Label><Input value={form.onlyfans_account_id} onChange={e => setForm(f => ({ ...f, onlyfans_account_id: e.target.value }))} className="bg-secondary border-border" placeholder="e.g. acct_xxx" /></div>
                <div><Label>Display Name</Label><Input value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} className="bg-secondary border-border" placeholder="e.g. Model Name" /></div>
                <div className="flex items-center gap-3"><Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} /><Label>Active</Label></div>
                <Button className="w-full" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate({ ...form, id: editAccount?.id })}>
                  {saveMutation.isPending ? "Saving..." : "Save Account"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground">Loading...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {accounts.map((account: any) => (
              <div key={account.id} className="bg-card border border-border rounded-[10px] p-5 relative">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold ${account.is_active ? "bg-primary/20 text-primary" : "bg-destructive/20 text-destructive"}`}>
                      {account.display_name.charAt(0)}
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{account.display_name}</p>
                      <p className="text-xs text-muted-foreground">@{account.username || "—"}</p>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(account)} className="p-1.5 rounded-md hover:bg-white/[0.04] text-muted-foreground hover:text-foreground transition-colors"><Pencil className="h-3.5 w-3.5" /></button>
                    <button onClick={() => deleteMutation.mutate(account.id)} className="p-1.5 rounded-md hover:bg-white/[0.04] text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-y-2 text-sm">
                  <div><span className="text-muted-foreground text-xs">Subscribers</span><p className="font-mono text-foreground">{(account.subscribers_count ?? 0).toLocaleString()}</p></div>
                  <div><span className="text-muted-foreground text-xs">Top %</span><p className="font-mono text-foreground">{account.performer_top != null ? `${account.performer_top}%` : "—"}</p></div>
                  <div><span className="text-muted-foreground text-xs">Price</span><p className="font-mono text-foreground">{account.subscribe_price > 0 ? `$${Number(account.subscribe_price).toFixed(2)}` : "Free"}</p></div>
                  <div><span className="text-muted-foreground text-xs">Last Seen</span><p className="text-foreground text-xs">{account.last_seen ? format(new Date(account.last_seen), "MMM d, HH:mm") : "—"}</p></div>
                </div>
                {account.is_active && (
                  <div className="absolute top-4 right-14 w-2 h-2 rounded-full bg-primary" />
                )}
              </div>
            ))}
            {!accounts.length && (
              <div className="col-span-3 p-12 text-center text-muted-foreground">No accounts yet. Run a sync to populate.</div>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
