import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
    onSuccess: () => {
      toast.success("Account saved");
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      setDialogOpen(false);
      resetForm();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAccount,
    onSuccess: () => {
      toast.success("Account deleted");
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const resetForm = () => {
    setEditAccount(null);
    setForm({ onlyfans_account_id: "", display_name: "", is_active: true });
  };

  const openEdit = (account: any) => {
    setEditAccount(account);
    setForm({
      onlyfans_account_id: account.onlyfans_account_id,
      display_name: account.display_name,
      is_active: account.is_active,
    });
    setDialogOpen(true);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Account Management</h1>
            <p className="text-sm text-muted-foreground">Map OnlyFans account IDs to internal names</p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" /> Add Account</Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border">
              <DialogHeader>
                <DialogTitle>{editAccount ? "Edit Account" : "Add Account"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>OnlyFans Account ID</Label>
                  <Input value={form.onlyfans_account_id} onChange={e => setForm(f => ({ ...f, onlyfans_account_id: e.target.value }))} className="bg-secondary border-border" placeholder="e.g. 123456789" />
                </div>
                <div>
                  <Label>Display Name</Label>
                  <Input value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} className="bg-secondary border-border" placeholder="e.g. Model Name" />
                </div>
                <div className="flex items-center gap-3">
                  <Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
                  <Label>Active</Label>
                </div>
                <Button
                  className="w-full"
                  disabled={saveMutation.isPending}
                  onClick={() => saveMutation.mutate({ ...form, id: editAccount?.id })}
                >
                  {saveMutation.isPending ? "Saving..." : "Save Account"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <Card className="border-border bg-card">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Loading...</div>
            ) : (
              <Table>
                <TableHeader>
                 <TableRow className="bg-secondary/50 hover:bg-secondary/50">
                     <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Display Name</TableHead>
                     <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Username</TableHead>
                     <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">OF Account ID</TableHead>
                     <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Status</TableHead>
                     <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Last Synced</TableHead>
                     <TableHead className="text-xs uppercase tracking-wider text-muted-foreground text-right">Actions</TableHead>
                   </TableRow>
                </TableHeader>
                <TableBody>
                  {accounts.map((account: any) => (
                   <TableRow key={account.id} className="hover:bg-secondary/30">
                       <TableCell className="font-medium">{account.display_name}</TableCell>
                       <TableCell className="text-muted-foreground">{account.username || "—"}</TableCell>
                       <TableCell className="font-mono text-muted-foreground">{account.onlyfans_account_id}</TableCell>
                       <TableCell>
                         <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${account.is_active ? "bg-primary/20 text-primary" : "bg-destructive/20 text-destructive"}`}>
                           {account.is_active ? "Active" : "Inactive"}
                         </span>
                       </TableCell>
                       <TableCell className="text-sm text-muted-foreground">
                         {account.last_synced_at ? format(new Date(account.last_synced_at), "MMM d, HH:mm") : "Never"}
                       </TableCell>
                       <TableCell className="text-right">
                         <Button variant="ghost" size="sm" onClick={() => openEdit(account)}><Pencil className="h-4 w-4" /></Button>
                         <Button variant="ghost" size="sm" onClick={() => deleteMutation.mutate(account.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                       </TableCell>
                     </TableRow>
                   ))}
                   {!accounts.length && (
                     <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No accounts yet. Synced accounts will appear here automatically.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
