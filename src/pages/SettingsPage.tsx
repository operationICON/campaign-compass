import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { fetchSyncSettings, updateSyncSetting } from "@/lib/supabase-helpers";
import {
  getTrafficSources, createTrafficSource, updateTrafficSource, deleteTrafficSource, bulkUpdateTrackingLinks,
  getUsers, createUser, updateUser, deleteUser,
} from "@/lib/api";
import { toast } from "sonner";
import { Settings, Clock, CreditCard, Globe, Pencil, Trash2, Plus, Loader2, Users, KeyRound, ShieldCheck } from "lucide-react";
import { RefreshButton } from "@/components/RefreshButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";

type Tab = "general" | "sources" | "users";

const FREQUENCY_OPTIONS = [
  { label: "Every 3 days", value: "3", desc: "~10 syncs/month", credits: "~50 credits" },
  { label: "Weekly", value: "7", desc: "~4 syncs/month", credits: "~20 credits" },
  { label: "Every 14 days", value: "14", desc: "~2 syncs/month", credits: "~10 credits" },
  { label: "Monthly", value: "30", desc: "1 sync/month", credits: "~5 credits" },
];

const OT_INTERVAL_OPTIONS = [
  { label: "Every 1 hour", value: "1", desc: "Freshest data" },
  { label: "Every 4 hours", value: "4", desc: "Recommended" },
  { label: "Every 8 hours", value: "8", desc: "3×/day" },
  { label: "Every 12 hours", value: "12", desc: "2×/day" },
  { label: "Every 24 hours", value: "24", desc: "Once a day" },
];

export default function SettingsPage() {
  const { user: authUser } = useAuth();
  const isAdmin = authUser?.role === "admin";
  const [activeTab, setActiveTab] = useState<Tab>("general");

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: "general", label: "General", icon: Clock },
    { id: "sources", label: "Traffic Sources", icon: Globe },
    ...(isAdmin ? [{ id: "users" as Tab, label: "Users", icon: Users }] : []),
  ];

  return (
    <DashboardLayout>
      <div className="w-full px-6 py-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Settings className="h-5 w-5 text-primary" />
            <div>
              <h1 className="text-[22px] font-medium text-foreground">Settings</h1>
              <p className="text-sm text-muted-foreground">Configure sync schedule and users</p>
            </div>
          </div>
          <RefreshButton queryKeys={["sync_settings"]} />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-secondary rounded-xl w-fit">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === t.id
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === "general" && <GeneralTab />}
        {activeTab === "sources" && <TrafficSourcesSection />}
        {activeTab === "users" && isAdmin && <UsersSection />}
      </div>
    </DashboardLayout>
  );
}

function GeneralTab() {
  const queryClient = useQueryClient();
  const { data: settings = [] } = useQuery({ queryKey: ["sync_settings"], queryFn: fetchSyncSettings });
  const [frequency, setFrequency] = useState("3");
  const [otInterval, setOtInterval] = useState("4");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const freq = (settings as any[]).find((s: any) => s.key === "sync_frequency_days");
    if (freq) setFrequency(freq.value);
    const ot = (settings as any[]).find((s: any) => s.key === "ot_sync_interval_hours");
    if (ot) setOtInterval(ot.value);
  }, [settings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await Promise.all([
        updateSyncSetting("sync_frequency_days", frequency),
        updateSyncSetting("ot_sync_interval_hours", otInterval),
      ]);
      queryClient.invalidateQueries({ queryKey: ["sync_settings"] });
      toast.success("Settings saved");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const selectedOpt = FREQUENCY_OPTIONS.find(o => o.value === frequency);

  return (
    <div className="bg-card border border-border rounded-2xl p-6 space-y-8">
      {/* Dashboard Sync Frequency */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-bold text-foreground">Dashboard Sync Frequency</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-5">
          How often the system automatically syncs accounts and tracking links.
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
        {selectedOpt && (
          <div className="bg-secondary/50 border border-border rounded-xl p-4 flex items-center gap-3 mt-4">
            <CreditCard className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm text-foreground font-medium">Estimated usage: {selectedOpt.credits}/month</p>
              <p className="text-xs text-muted-foreground">{selectedOpt.desc}</p>
            </div>
          </div>
        )}
      </div>

      {/* OnlyTraffic Auto-Sync */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-bold text-foreground">OnlyTraffic Auto-Sync</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-5">
          How often the server automatically pulls fresh order data from OnlyTraffic. Checked every 30 minutes.
        </p>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
          {OT_INTERVAL_OPTIONS.map((opt) => (
            <button key={opt.value} onClick={() => setOtInterval(opt.value)}
              className={`p-3 rounded-xl border text-left transition-all duration-200 ${
                otInterval === opt.value ? "bg-primary/10 border-primary ring-2 ring-primary/30" : "bg-secondary border-border hover:border-primary/40"
              }`}>
              <div className="flex items-center gap-1.5 mb-1">
                <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${otInterval === opt.value ? "border-primary" : "border-muted-foreground"}`}>
                  {otInterval === opt.value && <div className="w-1.5 h-1.5 rounded-full bg-primary" />}
                </div>
                <span className={`text-xs font-semibold ${otInterval === opt.value ? "text-foreground" : "text-muted-foreground"}`}>{opt.label}</span>
              </div>
              <p className="text-[10px] text-muted-foreground ml-5">{opt.desc}</p>
            </button>
          ))}
        </div>
      </div>

      <button onClick={handleSave} disabled={saving}
        className="px-5 py-2.5 rounded-xl gradient-bg text-white text-sm font-semibold hover:opacity-90 transition-all duration-200 disabled:opacity-50 hero-glow">
        {saving ? "Saving..." : "Save Settings"}
      </button>
    </div>
  );
}

function TrafficSourcesSection() {
  const queryClient = useQueryClient();
  const { data: sources = [], isLoading } = useQuery({ queryKey: ["traffic_sources"], queryFn: getTrafficSources });
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
      await createTrafficSource({ name: inputName.trim() });
      toast.success("Source created");
      invalidateAll(); setAddingNew(false); setInputName("");
    } catch { toast.error("Failed to create source"); }
    setSaving(false);
  };

  const handleUpdate = async () => {
    if (!inputName.trim() || !editingSource) return;
    setSaving(true);
    try {
      await updateTrafficSource(editingSource.id, { name: inputName.trim() });
      toast.success("Source updated");
      invalidateAll(); setEditingSource(null); setInputName("");
    } catch { toast.error("Failed to update source"); }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deletingSource) return;
    setSaving(true);
    try {
      await deleteTrafficSource(deletingSource.id);
      toast.success("Source deleted");
      invalidateAll(); setDeletingSource(null);
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
          <p className="text-xs text-muted-foreground">Manage all traffic sources used across your campaigns</p>
        </div>
        <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => { setAddingNew(true); setInputName(""); }}>
          <Plus className="h-3.5 w-3.5" /> Add New Source
        </Button>
      </div>

      {addingNew && (
        <div className="flex items-center gap-2 p-3 border border-border rounded-lg bg-secondary/50">
          <Input type="text" value={inputName} onChange={(e) => setInputName(e.target.value)} placeholder="Source name..."
            className="h-8 text-sm bg-card border-border flex-1" autoFocus />
          <Button size="sm" className="h-8 text-xs" onClick={handleCreate} disabled={!inputName.trim() || saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Create"}
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { setAddingNew(false); setInputName(""); }}>Cancel</Button>
        </div>
      )}

      {deletingSource && (
        <div className="p-3 border border-destructive/30 rounded-lg bg-destructive/5 space-y-2">
          <p className="text-xs text-destructive font-medium">Delete "{deletingSource.name}"? All campaigns using this source will become Untagged.</p>
          <div className="flex gap-1.5">
            <Button size="sm" variant="destructive" className="h-8 text-xs" onClick={handleDelete} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Confirm Delete"}
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setDeletingSource(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </div>
      ) : (sources as any[]).length === 0 ? (
        <p className="text-xs text-muted-foreground italic py-4">No sources yet.</p>
      ) : (
        <div className="border border-border rounded-lg divide-y divide-border">
          {(sources as any[]).map((s: any) => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-3">
              {editingSource?.id === s.id ? (
                <>
                  <span className="w-2.5 h-2.5 rounded-full bg-muted-foreground shrink-0" />
                  <Input type="text" value={inputName} onChange={(e) => setInputName(e.target.value)}
                    className="h-8 text-sm bg-card border-border flex-1" autoFocus />
                  <Button size="sm" className="h-8 text-xs" onClick={handleUpdate} disabled={!inputName.trim() || saving}>
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Update"}
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { setEditingSource(null); setInputName(""); }}>Cancel</Button>
                </>
              ) : (
                <>
                  <span className="w-2.5 h-2.5 rounded-full bg-muted-foreground shrink-0" />
                  <span className="text-sm text-foreground font-medium flex-1">{s.name}</span>
                  <button onClick={() => { setEditingSource(s); setInputName(s.name); }} className="text-muted-foreground hover:text-foreground p-1 transition-colors">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => setDeletingSource(s)} className="text-muted-foreground hover:text-destructive p-1 transition-colors">
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

function UsersSection() {
  const queryClient = useQueryClient();
  const { user: authUser } = useAuth();
  const { data: userList = [], isLoading } = useQuery({ queryKey: ["auth_users"], queryFn: getUsers });

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "user">("user");
  const [saving, setSaving] = useState(false);

  const [editingUser, setEditingUser] = useState<any>(null);
  const [editRole, setEditRole] = useState<"admin" | "user">("user");
  const [editName, setEditName] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [deletingUser, setDeletingUser] = useState<any>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["auth_users"] });

  const handleCreate = async () => {
    if (!newName.trim() || !newEmail.trim() || !newPassword.trim()) return;
    setSaving(true);
    try {
      await createUser({ name: newName.trim(), email: newEmail.trim(), password: newPassword, role: newRole });
      toast.success("User created");
      invalidate();
      setCreating(false); setNewName(""); setNewEmail(""); setNewPassword(""); setNewRole("user");
    } catch (err: any) {
      toast.error(err.message?.includes("409") || err.message?.includes("already") ? "Email already exists" : "Failed to create user");
    }
    setSaving(false);
  };

  const handleUpdate = async () => {
    if (!editingUser) return;
    setSaving(true);
    const body: any = {};
    if (editName.trim() && editName !== editingUser.name) body.name = editName.trim();
    if (editRole !== editingUser.role) body.role = editRole;
    if (resetPassword.trim()) body.password = resetPassword.trim();
    if (!Object.keys(body).length) { setEditingUser(null); setSaving(false); return; }
    try {
      await updateUser(editingUser.id, body);
      toast.success("User updated");
      invalidate(); setEditingUser(null); setResetPassword("");
    } catch { toast.error("Failed to update user"); }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deletingUser) return;
    setSaving(true);
    try {
      await deleteUser(deletingUser.id);
      toast.success("User deleted");
      invalidate(); setDeletingUser(null);
    } catch { toast.error("Failed to delete user"); }
    setSaving(false);
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Users className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-bold text-foreground">Users</h2>
          </div>
          <p className="text-xs text-muted-foreground">Manage who has access to CT Tracker</p>
        </div>
        <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => setCreating(true)}>
          <Plus className="h-3.5 w-3.5" /> Add User
        </Button>
      </div>

      {/* Create form */}
      {creating && (
        <div className="p-4 border border-border rounded-xl bg-secondary/50 space-y-3">
          <p className="text-xs font-semibold text-foreground">New user</p>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Full name" value={newName} onChange={(e) => setNewName(e.target.value)} className="h-8 text-sm" />
            <Input placeholder="Email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className="h-8 text-sm" />
            <Input placeholder="Password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="h-8 text-sm" />
            <select value={newRole} onChange={(e) => setNewRole(e.target.value as any)}
              className="h-8 px-2 text-sm rounded-md border border-border bg-card text-foreground">
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="h-8 text-xs" onClick={handleCreate} disabled={saving || !newName || !newEmail || !newPassword}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Create"}
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setCreating(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deletingUser && (
        <div className="p-3 border border-destructive/30 rounded-lg bg-destructive/5 space-y-2">
          <p className="text-xs text-destructive font-medium">Delete user "{deletingUser.name}" ({deletingUser.email})?</p>
          <div className="flex gap-1.5">
            <Button size="sm" variant="destructive" className="h-8 text-xs" onClick={handleDelete} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Confirm Delete"}
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setDeletingUser(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </div>
      ) : (userList as any[]).length === 0 ? (
        <p className="text-xs text-muted-foreground italic py-4">No users yet.</p>
      ) : (
        <div className="border border-border rounded-lg divide-y divide-border">
          {(userList as any[]).map((u: any) => (
            <div key={u.id}>
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="w-7 h-7 rounded-full gradient-bg flex items-center justify-center text-white text-[11px] font-bold shrink-0">
                  {u.name?.split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2) || "?"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground truncate">{u.name}</span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                      u.role === "admin" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
                    }`}>{u.role === "admin" ? "Admin" : "User"}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{u.email}</p>
                </div>
                {u.id !== authUser?.id && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => { setEditingUser(u); setEditName(u.name); setEditRole(u.role); setResetPassword(""); }}
                      className="text-muted-foreground hover:text-foreground p-1.5 transition-colors rounded"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => setDeletingUser(u)} className="text-muted-foreground hover:text-destructive p-1.5 transition-colors rounded">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {editingUser?.id === u.id && (
                <div className="px-4 pb-4 pt-0 space-y-3 bg-secondary/30">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[10px] text-muted-foreground uppercase">Name</label>
                      <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-8 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-muted-foreground uppercase">Role</label>
                      <select value={editRole} onChange={(e) => setEditRole(e.target.value as any)}
                        className="w-full h-8 px-2 text-sm rounded-md border border-border bg-card text-foreground">
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                    <div className="space-y-1 col-span-2">
                      <label className="text-[10px] text-muted-foreground uppercase flex items-center gap-1">
                        <KeyRound className="h-3 w-3" /> New password (leave blank to keep)
                      </label>
                      <Input type="password" placeholder="New password..." value={resetPassword}
                        onChange={(e) => setResetPassword(e.target.value)} className="h-8 text-sm" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" className="h-8 text-xs" onClick={handleUpdate} disabled={saving}>
                      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setEditingUser(null)}>Cancel</Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
