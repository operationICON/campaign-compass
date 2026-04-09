import { useState, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { ModelAvatar } from "@/components/ModelAvatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerClose,
} from "@/components/ui/drawer";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  UserPlus, DollarSign, MessageCircle, Bell, RefreshCw, Info, X,
  ArrowLeft, Copy, ExternalLink, ChevronDown,
} from "lucide-react";
import { toast } from "sonner";

/* ─── localStorage helpers ─── */
function lsGet(key: string): Record<string, any> {
  try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch { return {}; }
}
function lsSet(key: string, val: Record<string, any>) {
  localStorage.setItem(key, JSON.stringify(val));
}

function shortTimeAgo(dateStr: string | null) {
  if (!dateStr) return "—";
  try {
    const ms = Date.now() - new Date(dateStr).getTime();
    if (ms < 60_000) return "just now";
    if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`;
    if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}h ago`;
    return `${Math.floor(ms / 86400_000)}d ago`;
  } catch { return "—"; }
}

const TIME_PILLS = [
  { key: "day", label: "Last Day" },
  { key: "week", label: "Last Week" },
  { key: "month", label: "Last Month" },
  { key: "all", label: "All Time" },
] as const;
type TimePill = typeof TIME_PILLS[number]["key"];

/* ─── page ─── */
export default function FansPage() {
  const queryClient = useQueryClient();
  const [timePill, setTimePill] = useState<TimePill>("day");
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);

  // Bottom sheet state
  const [sheetFan, setSheetFan] = useState<any | null>(null);
  const [sheetChat, setSheetChat] = useState<any | null>(null);

  // View-all drawer state
  const [fanDrawerAccountId, setFanDrawerAccountId] = useState<string | null>(null);
  const [chatDrawerAccountId, setChatDrawerAccountId] = useState<string | null>(null);

  // localStorage state
  const [welcomed, setWelcomed] = useState<Record<string, boolean>>(lsGet("fans_welcomed"));
  const [fanNotes, setFanNotes] = useState<Record<string, string>>(lsGet("fans_notes"));
  const [chatDone, setChatDone] = useState<Record<string, boolean>>(lsGet("chats_done"));
  const [chatFlagged, setChatFlagged] = useState<Record<string, boolean>>(lsGet("chats_flagged"));
  const [chatNotes, setChatNotes] = useState<Record<string, string>>(lsGet("chats_notes"));
  const [fanFlagged, setFanFlagged] = useState<Record<string, boolean>>(lsGet("fans_flagged"));
  const [sheetNoteInput, setSheetNoteInput] = useState("");

  /* ─── queries ─── */
  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
      const { data } = await supabase.from("accounts")
        .select("id, display_name, username, avatar_thumb_url, is_active")
        .eq("is_active", true).order("display_name");
      return data || [];
    },
  });

  const { data: newFans = [], isLoading: fansLoading } = useQuery({
    queryKey: ["chatting_team_new_fans"],
    queryFn: async () => {
      const { data } = await supabase.from("chatting_team_new_fans")
        .select("*").order("subscribed_at", { ascending: false });
      return data || [];
    },
  });

  const { data: chats = [], isLoading: chatsLoading } = useQuery({
    queryKey: ["chatting_team_chats"],
    queryFn: async () => {
      const { data } = await supabase.from("chatting_team_chats")
        .select("*").order("last_message_at", { ascending: false });
      return data || [];
    },
  });

  /* ─── derived ─── */
  const lastUpdated = useMemo(() => {
    const dates = newFans.map(f => f.fetched_at).filter(Boolean) as string[];
    if (!dates.length) return null;
    return dates.reduce((a, b) => (a > b ? a : b));
  }, [newFans]);

  const isStale = useMemo(() => {
    if (!lastUpdated) return false;
    return Date.now() - new Date(lastUpdated).getTime() > 2 * 3600_000;
  }, [lastUpdated]);

  // KPI filtered by selectedModelId
  const kpiFans = useMemo(() => {
    if (!selectedModelId) return newFans;
    return newFans.filter(x => x.account_id === selectedModelId);
  }, [newFans, selectedModelId]);

  const kpiChats = useMemo(() => {
    if (!selectedModelId) return chats;
    return chats.filter(x => x.account_id === selectedModelId);
  }, [chats, selectedModelId]);

  const totalNewFans = kpiFans.length;
  const paidFans = kpiFans.filter(f => f.subscription_type === "Paid").length;
  const paidPct = totalNewFans > 0 ? Math.round((paidFans / totalNewFans) * 100) : 0;
  const activeChats = kpiChats.length;
  const unreadChats = kpiChats.filter(c => c.is_unread).length;

  const fansByAccount = useMemo(() => {
    const map: Record<string, typeof newFans> = {};
    for (const a of accounts) map[a.id] = [];
    for (const f of newFans) {
      if (f.account_id && map[f.account_id]) map[f.account_id].push(f);
    }
    return map;
  }, [newFans, accounts]);

  const chatsByAccount = useMemo(() => {
    const map: Record<string, typeof chats> = {};
    for (const a of accounts) map[a.id] = [];
    for (const c of chats) {
      if (c.account_id && map[c.account_id]) map[c.account_id].push(c);
    }
    return map;
  }, [chats, accounts]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await new Promise(r => setTimeout(r, 2000));
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["chatting_team_new_fans"] }),
      queryClient.invalidateQueries({ queryKey: ["chatting_team_chats"] }),
    ]);
    setRefreshing(false);
  };

  // localStorage actions
  const toggle = (key: string, setter: React.Dispatch<React.SetStateAction<Record<string, boolean>>>, id: string) => {
    setter(prev => { const next = { ...prev, [id]: !prev[id] }; lsSet(key, next); return next; });
  };
  const saveNote = (key: string, setter: React.Dispatch<React.SetStateAction<Record<string, string>>>, id: string, note: string) => {
    setter(prev => { const next = { ...prev, [id]: note }; lsSet(key, next); return next; });
  };

  const selectedAccount = selectedModelId ? accounts.find(a => a.id === selectedModelId) : null;
  const modelFans = selectedModelId ? (fansByAccount[selectedModelId] || []) : [];
  const modelChats = selectedModelId ? (chatsByAccount[selectedModelId] || []) : [];

  const openFanSheet = (fan: any) => { setSheetChat(null); setSheetFan(fan); setSheetNoteInput(fanNotes[fan.id] || ""); };
  const openChatSheet = (chat: any) => { setSheetFan(null); setSheetChat(chat); setSheetNoteInput(chatNotes[chat.id] || ""); };

  return (
    <DashboardLayout>
      <div className="space-y-5">
        {/* HEADER */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-[20px] font-bold text-foreground">Fans</h1>
            <p className="text-[12px] text-muted-foreground mt-0.5">Daily fan lists for the chatting team</p>
          </div>
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <span>Last updated: {lastUpdated ? shortTimeAgo(lastUpdated) : "—"}</span>
            <button onClick={handleRefresh} disabled={refreshing}
              className="p-2 rounded-lg border border-border hover:bg-secondary transition-colors disabled:opacity-50">
              <RefreshCw className={`h-4 w-4 text-muted-foreground ${refreshing ? "animate-spin" : ""}`} />
            </button>
            {refreshing && <span className="text-primary text-[12px]">Refreshing...</span>}
          </div>
        </div>

        {/* STALE BANNER */}
        {isStale && !bannerDismissed && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-[12px] text-blue-300">
            <Info className="h-4 w-4 shrink-0 text-blue-400" />
            <span className="flex-1">Fan data is cached and updated manually. Click refresh to reload from the database.</span>
            <button onClick={() => setBannerDismissed(true)} className="p-1 hover:bg-blue-500/20 rounded"><X className="h-3.5 w-3.5" /></button>
          </div>
        )}

        {/* FILTER ROW */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          {/* All Models dropdown */}
          <div className="relative">
            <button onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
              className="h-9 min-w-[200px] px-3 rounded-lg border border-border bg-card text-sm text-foreground flex items-center gap-2 cursor-pointer">
              {selectedAccount ? (
                <>
                  <ModelAvatar avatarUrl={selectedAccount.avatar_thumb_url} name={selectedAccount.display_name} size={22} />
                  <span className="truncate">{selectedAccount.display_name}</span>
                </>
              ) : <span>All Models</span>}
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-auto shrink-0" />
            </button>
            {modelDropdownOpen && (
              <div className="absolute left-0 top-full mt-1 z-50 min-w-[240px] bg-card border border-border rounded-lg shadow-lg py-1 max-h-80 overflow-y-auto">
                <button onClick={() => { setSelectedModelId(null); setModelDropdownOpen(false); }}
                  className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-secondary/50 transition-colors ${!selectedModelId ? "bg-primary/5 text-primary font-medium" : "text-foreground"}`}>
                  All Models
                </button>
                {accounts.map(acc => (
                  <button key={acc.id} onClick={() => { setSelectedModelId(acc.id); setModelDropdownOpen(false); }}
                    className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2.5 hover:bg-secondary/50 transition-colors ${selectedModelId === acc.id ? "bg-primary/5 text-primary font-medium" : "text-foreground"}`}>
                    <ModelAvatar avatarUrl={acc.avatar_thumb_url} name={acc.display_name} size={28} />
                    <span>{acc.display_name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1">
            {TIME_PILLS.map(p => (
              <button key={p.key} onClick={() => setTimePill(p.key)}
                className={`px-3 py-1.5 text-[12px] font-medium rounded-lg transition-colors ${timePill === p.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"}`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* KPI CARDS */}
        <div className="grid grid-cols-4 gap-4">
          <KpiCard icon={UserPlus} label="Total New Fans" value={totalNewFans} subtitle="Last 24 hours" color="text-primary" iconBg="bg-primary/10" />
          <KpiCard icon={DollarSign} label="Paid Fans" value={paidFans} subtitle={`${paidPct}% of new fans`} color="text-emerald-400" iconBg="bg-emerald-500/10" />
          <KpiCard icon={MessageCircle} label="Active Chats" value={activeChats} subtitle="Last 24 hours" color="text-blue-400" iconBg="bg-blue-500/10" />
          <KpiCard icon={Bell} label="Unread" value={unreadChats} subtitle="Need reply"
            color={unreadChats > 0 ? "text-amber-400" : "text-muted-foreground"}
            iconBg={unreadChats > 0 ? "bg-amber-500/10" : "bg-muted/50"} />
        </div>

        {/* ─── VIEW 1: ALL MODELS ─── */}
        {!selectedModelId ? (
          <div className="space-y-3">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">All Models — Click to View</p>
            {(fansLoading || chatsLoading) ? (
              <div className="grid grid-cols-4 gap-3">
                {[1,2,3,4].map(i => <Skeleton key={i} className="h-[120px] rounded-xl" />)}
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-3">
                {accounts.map(a => {
                  const fCount = (fansByAccount[a.id] || []).length;
                  const cCount = (chatsByAccount[a.id] || []).length;
                  const uCount = (chatsByAccount[a.id] || []).filter(c => c.is_unread).length;
                  return (
                    <button key={a.id} onClick={() => setSelectedModelId(a.id)}
                      className="bg-card border border-border rounded-xl p-4 flex flex-col gap-3 hover:border-primary/40 hover:-translate-y-0.5 transition-all cursor-pointer text-left">
                      <div className="flex items-center gap-2.5">
                        <ModelAvatar avatarUrl={a.avatar_thumb_url} name={a.display_name} size={36} />
                        <div className="min-w-0">
                          <div className="text-[12px] font-semibold text-foreground truncate">{a.display_name}</div>
                          {a.username && <div className="text-[10px] text-muted-foreground truncate">@{(a.username || "").replace("@","")}</div>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <MiniStat label="New Fans" value={fCount} color="text-emerald-400" />
                        <MiniStat label="Chatted" value={cCount} color="text-blue-400" />
                        <MiniStat label="Unread" value={uCount} color="text-amber-400" />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* ─── VIEW 2: MODEL DETAIL ─── */
          <div className="space-y-4">
            <button onClick={() => setSelectedModelId(null)}
              className="flex items-center gap-1.5 text-[12px] text-primary hover:underline">
              <ArrowLeft className="h-3.5 w-3.5" /> All models
            </button>

            {/* Model detail header */}
            <div className="flex items-center justify-between bg-card border border-border rounded-xl px-5 py-3">
              <div className="flex items-center gap-3">
                <ModelAvatar avatarUrl={selectedAccount?.avatar_thumb_url} name={selectedAccount?.display_name || ""} size={44} />
                <div>
                  <div className="text-[15px] font-bold text-foreground">{selectedAccount?.display_name}</div>
                  {selectedAccount?.username && <div className="text-[11px] text-muted-foreground">@{(selectedAccount.username || "").replace("@","")}</div>}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <StatPill label="New Fans" value={modelFans.length} color="text-primary bg-primary/10" />
                <StatPill label="Chatted" value={modelChats.length} color="text-blue-400 bg-blue-500/10" />
                <StatPill label="Unread" value={modelChats.filter(c => c.is_unread).length} color="text-amber-400 bg-amber-500/10" />
              </div>
            </div>

            {/* Two panels */}
            <div className="grid grid-cols-2 gap-4">
              {/* NEW FANS PANEL */}
              <div className="bg-card border border-border rounded-2xl border-l-[3px] border-l-emerald-500 overflow-hidden">
                <div className="px-4 pt-4 pb-3 flex items-center gap-2">
                  <span className="text-[14px] font-bold text-foreground">New Fans</span>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-medium">{modelFans.length}</span>
                </div>
                {fansLoading ? (
                  <div className="px-4 pb-4 grid grid-cols-2 gap-2">
                    {[1,2,3,4].map(i => <Skeleton key={i} className="h-[80px] rounded-lg" />)}
                  </div>
                ) : modelFans.length === 0 ? (
                  <div className="px-4 pb-6 pt-2 text-center text-[12px] text-muted-foreground">No new fans in the last 24 hours</div>
                ) : (
                  <>
                    <div className="px-4 pb-3 grid grid-cols-2 gap-px bg-border/30">
                      {modelFans.slice(0, 6).map(fan => (
                        <button key={fan.id} onClick={() => openFanSheet(fan)}
                          className={`flex items-center gap-2.5 p-3 bg-card hover:bg-secondary/30 transition-colors cursor-pointer text-left ${fanFlagged[fan.id] ? "border-l-2 border-l-amber-400" : ""}`}>
                          <FanAvatar url={fan.fan_avatar} name={fan.fan_name} size={32} />
                          <div className="min-w-0 flex-1">
                            <div className="text-[11px] font-semibold text-foreground truncate">{fan.fan_name || "Unknown"}</div>
                            <div className="text-[10px] text-muted-foreground">{shortTimeAgo(fan.subscribed_at)}</div>
                          </div>
                          <div className="shrink-0">
                            {fan.subscription_type === "Paid" ? (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium">Paid</span>
                            ) : (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">Free</span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                    <button onClick={() => setFanDrawerAccountId(selectedModelId)}
                      className="w-full py-2.5 text-[12px] font-medium text-primary hover:bg-primary/5 transition-colors border-t border-border">
                      View all {modelFans.length} new fans →
                    </button>
                  </>
                )}
              </div>

              {/* CHATTED PANEL */}
              <div className="bg-card border border-border rounded-2xl border-l-[3px] border-l-blue-500 overflow-hidden">
                <div className="px-4 pt-4 pb-3 flex items-center gap-2">
                  <span className="text-[14px] font-bold text-foreground">Chatted</span>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 font-medium">{modelChats.length}</span>
                </div>
                {chatsLoading ? (
                  <div className="px-4 pb-4 grid grid-cols-2 gap-2">
                    {[1,2,3,4].map(i => <Skeleton key={i} className="h-[80px] rounded-lg" />)}
                  </div>
                ) : modelChats.length === 0 ? (
                  <div className="px-4 pb-6 pt-2 text-center text-[12px] text-muted-foreground">No chat activity in the last 24 hours</div>
                ) : (
                  <>
                    <div className="px-4 pb-3 grid grid-cols-2 gap-px bg-border/30">
                      {modelChats.slice(0, 6).map(chat => (
                        <button key={chat.id} onClick={() => openChatSheet(chat)}
                          className={`flex items-center gap-2.5 p-3 bg-card hover:bg-secondary/30 transition-colors cursor-pointer text-left ${chatDone[chat.id] ? "opacity-50" : ""} ${chatFlagged[chat.id] ? "border-l-2 border-l-amber-400" : ""}`}>
                          <div className="relative shrink-0">
                            <FanAvatar url={chat.fan_avatar} name={chat.fan_name} size={32} />
                            {chat.is_unread && <span className="absolute -top-0.5 -right-0.5 w-[6px] h-[6px] rounded-full bg-amber-400" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-[11px] font-semibold text-foreground truncate">{chat.fan_name || "Unknown"}</div>
                            {chat.last_message_preview && (
                              <div className="text-[10px] text-muted-foreground italic truncate">{(chat.last_message_preview || "").slice(0, 30)}</div>
                            )}
                          </div>
                          <div className="text-[10px] text-muted-foreground shrink-0">{shortTimeAgo(chat.last_message_at)}</div>
                        </button>
                      ))}
                    </div>
                    <button onClick={() => setChatDrawerAccountId(selectedModelId)}
                      className="w-full py-2.5 text-[12px] font-medium text-primary hover:bg-primary/5 transition-colors border-t border-border">
                      View all {modelChats.length} chats →
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ═══ BOTTOM SHEET — FAN ═══ */}
      <Drawer open={!!sheetFan} onOpenChange={(o) => { if (!o) setSheetFan(null); }}>
        <DrawerContent className="max-h-[85vh]">
          {sheetFan && (
            <div className="px-6 pb-6 pt-2 space-y-4 overflow-y-auto">
              <div className="flex items-center gap-3">
                <FanAvatar url={sheetFan.fan_avatar} name={sheetFan.fan_name} size={48} />
                <div>
                  <div className="text-[15px] font-bold text-foreground">{sheetFan.fan_name || "Unknown"}</div>
                  {sheetFan.fan_username && <div className="text-[12px] text-muted-foreground">@{(sheetFan.fan_username || "").replace("@","")}</div>}
                </div>
              </div>

              {/* Meta badges */}
              <div className="flex items-center gap-2 flex-wrap">
                {sheetFan.subscription_type === "Paid" ? (
                  <span className="text-[11px] px-2 py-1 rounded-lg bg-primary/15 text-primary font-medium">
                    Paid{sheetFan.subscribe_price ? ` $${Number(sheetFan.subscribe_price).toFixed(2)}` : ""}
                  </span>
                ) : (
                  <span className="text-[11px] px-2 py-1 rounded-lg bg-muted text-muted-foreground font-medium">Free</span>
                )}
                <span className="text-[11px] px-2 py-1 rounded-lg bg-muted text-muted-foreground">{shortTimeAgo(sheetFan.subscribed_at)}</span>
                <span className="text-[11px] px-2 py-1 rounded-lg bg-blue-500/15 text-blue-400">New Fan</span>
              </div>

              {/* Action buttons 2x2 */}
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => toggle("fans_welcomed", setWelcomed, sheetFan.id)}
                  className={`h-9 text-[11px] font-medium rounded-lg border transition-colors ${welcomed[sheetFan.id] ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10" : "border-border text-muted-foreground hover:text-foreground hover:border-primary/30"}`}>
                  {welcomed[sheetFan.id] ? "✓ Welcomed" : "👋 Send Welcome"}
                </button>
                <button onClick={() => window.open(`https://onlyfans.com/${(sheetFan.fan_username || "").replace("@","")}`, "_blank")}
                  className="h-9 text-[11px] font-medium rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors flex items-center justify-center gap-1.5">
                  <ExternalLink className="h-3 w-3" /> Open on OnlyFans
                </button>
                <button onClick={() => toggle("fans_flagged", setFanFlagged, sheetFan.id)}
                  className={`h-9 text-[11px] font-medium rounded-lg border transition-colors ${fanFlagged[sheetFan.id] ? "border-amber-500/30 text-amber-400 bg-amber-500/10" : "border-border text-muted-foreground hover:text-foreground hover:border-amber-500/30"}`}>
                  {fanFlagged[sheetFan.id] ? "⚑ Flagged" : "⚑ Flag for follow-up"}
                </button>
                <button onClick={() => { navigator.clipboard.writeText(sheetFan.fan_username || ""); toast.success("Username copied"); }}
                  className="h-9 text-[11px] font-medium rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors flex items-center justify-center gap-1.5">
                  <Copy className="h-3 w-3" /> Copy username
                </button>
              </div>

              {/* Note */}
              <div className="space-y-2">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase">Note</label>
                <textarea value={sheetNoteInput} onChange={e => setSheetNoteInput(e.target.value)}
                  placeholder="Add a note about this fan..." rows={2}
                  className="w-full text-[12px] px-3 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary" />
                <button onClick={() => { saveNote("fans_notes", setFanNotes, sheetFan.id, sheetNoteInput); toast.success("Note saved"); }}
                  className="h-8 px-4 text-[11px] rounded-lg bg-primary text-primary-foreground font-medium">Save note</button>
                {fanNotes[sheetFan.id] && (
                  <div className="text-[11px] px-3 py-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    {fanNotes[sheetFan.id]}
                  </div>
                )}
              </div>
            </div>
          )}
        </DrawerContent>
      </Drawer>

      {/* ═══ BOTTOM SHEET — CHAT ═══ */}
      <Drawer open={!!sheetChat} onOpenChange={(o) => { if (!o) setSheetChat(null); }}>
        <DrawerContent className="max-h-[85vh]">
          {sheetChat && (
            <div className="px-6 pb-6 pt-2 space-y-4 overflow-y-auto">
              <div className="flex items-center gap-3">
                <FanAvatar url={sheetChat.fan_avatar} name={sheetChat.fan_name} size={48} />
                <div>
                  <div className="text-[15px] font-bold text-foreground">{sheetChat.fan_name || "Unknown"}</div>
                  {sheetChat.fan_username && <div className="text-[12px] text-muted-foreground">@{(sheetChat.fan_username || "").replace("@","")}</div>}
                </div>
              </div>

              {/* Meta badges */}
              <div className="flex items-center gap-2 flex-wrap">
                {sheetChat.is_unread ? (
                  <span className="text-[11px] px-2 py-1 rounded-lg bg-amber-500/15 text-amber-400 font-medium">Unread</span>
                ) : (
                  <span className="text-[11px] px-2 py-1 rounded-lg bg-muted text-muted-foreground font-medium">Read</span>
                )}
                <span className="text-[11px] px-2 py-1 rounded-lg bg-muted text-muted-foreground">{shortTimeAgo(sheetChat.last_message_at)}</span>
                <span className="text-[11px] px-2 py-1 rounded-lg bg-blue-500/15 text-blue-400">Active Chat</span>
              </div>

              {/* Action buttons */}
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => toggle("chats_done", setChatDone, sheetChat.id)}
                  className={`h-9 text-[11px] font-medium rounded-lg border transition-colors ${chatDone[sheetChat.id] ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10" : "border-border text-muted-foreground hover:text-foreground hover:border-primary/30"}`}>
                  {chatDone[sheetChat.id] ? "✓ Done" : "Mark as done"}
                </button>
                <button onClick={() => toggle("chats_flagged", setChatFlagged, sheetChat.id)}
                  className={`h-9 text-[11px] font-medium rounded-lg border transition-colors ${chatFlagged[sheetChat.id] ? "border-amber-500/30 text-amber-400 bg-amber-500/10" : "border-border text-muted-foreground hover:text-foreground hover:border-amber-500/30"}`}>
                  {chatFlagged[sheetChat.id] ? "⚑ Flagged" : "⚑ Flag"}
                </button>
                <button onClick={() => window.open(`https://onlyfans.com/my/chats/chat/${sheetChat.fan_id}`, "_blank")}
                  className="h-9 text-[11px] font-medium rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors flex items-center justify-center gap-1.5">
                  <ExternalLink className="h-3 w-3" /> Open chat on OF
                </button>
                <button onClick={() => { navigator.clipboard.writeText(sheetChat.fan_username || ""); toast.success("Username copied"); }}
                  className="h-9 text-[11px] font-medium rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors flex items-center justify-center gap-1.5">
                  <Copy className="h-3 w-3" /> Copy username
                </button>
              </div>

              {/* Note */}
              <div className="space-y-2">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase">Note</label>
                <textarea value={sheetNoteInput} onChange={e => setSheetNoteInput(e.target.value)}
                  placeholder="Add a note about this fan..." rows={2}
                  className="w-full text-[12px] px-3 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary" />
                <button onClick={() => { saveNote("chats_notes", setChatNotes, sheetChat.id, sheetNoteInput); toast.success("Note saved"); }}
                  className="h-8 px-4 text-[11px] rounded-lg bg-primary text-primary-foreground font-medium">Save note</button>
                {chatNotes[sheetChat.id] && (
                  <div className="text-[11px] px-3 py-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    {chatNotes[sheetChat.id]}
                  </div>
                )}
              </div>

              {/* Last message */}
              {sheetChat.last_message_preview && (
                <div className="space-y-2">
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase">Last messages</label>
                  <div className="flex">
                    <div className="max-w-[80%] px-3 py-2 rounded-lg bg-muted text-[12px] text-foreground">
                      {sheetChat.last_message_preview}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </DrawerContent>
      </Drawer>

      {/* ═══ VIEW-ALL FANS DRAWER (right slide) ═══ */}
      <Sheet open={!!fanDrawerAccountId} onOpenChange={(o) => { if (!o) setFanDrawerAccountId(null); }}>
        <SheetContent side="right" className="w-[480px] sm:max-w-[480px] p-0 flex flex-col">
          <SheetHeader className="px-5 pt-5 pb-3 border-b border-border">
            <div className="flex items-center gap-3">
              {selectedAccount && <ModelAvatar avatarUrl={selectedAccount.avatar_thumb_url} name={selectedAccount.display_name} size={36} />}
              <SheetTitle className="text-[16px]">{selectedAccount?.display_name} — New Fans</SheetTitle>
            </div>
            <div className="flex items-center gap-4 mt-2">
              <span className="text-[12px] text-foreground font-medium">{modelFans.length} total</span>
              <span className="text-[12px] text-emerald-400">{modelFans.filter(f => f.subscription_type === "Paid").length} paid</span>
              <span className="text-[12px] text-muted-foreground">{modelFans.filter(f => f.subscription_type !== "Paid").length} free</span>
            </div>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto">
            {modelFans.map(fan => (
              <button key={fan.id} onClick={() => openFanSheet(fan)}
                className={`w-full flex items-center gap-3 px-5 py-3 border-b border-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.04)] transition-colors text-left ${welcomed[fan.id] ? "opacity-60" : ""} ${fanFlagged[fan.id] ? "border-l-2 border-l-amber-400" : ""}`}>
                <FanAvatar url={fan.fan_avatar} name={fan.fan_name} size={36} />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-foreground truncate">
                    {fan.fan_name || "Unknown"}
                    {welcomed[fan.id] && <span className="ml-2 text-[10px] text-emerald-400">✓ Welcomed</span>}
                  </div>
                  {fan.fan_username && <div className="text-[11px] text-muted-foreground truncate">@{(fan.fan_username || "").replace("@","")}</div>}
                  {fanNotes[fan.id] && <div className="text-[10px] text-amber-400 mt-0.5 truncate">📝 {fanNotes[fan.id]}</div>}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-[10px] text-muted-foreground">{shortTimeAgo(fan.subscribed_at)}</span>
                  {fan.subscription_type === "Paid" ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium">Paid{fan.subscribe_price ? ` $${Number(fan.subscribe_price).toFixed(0)}` : ""}</span>
                  ) : (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">Free</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* ═══ VIEW-ALL CHATS DRAWER (right slide) ═══ */}
      <Sheet open={!!chatDrawerAccountId} onOpenChange={(o) => { if (!o) setChatDrawerAccountId(null); }}>
        <SheetContent side="right" className="w-[480px] sm:max-w-[480px] p-0 flex flex-col">
          <SheetHeader className="px-5 pt-5 pb-3 border-b border-border">
            <div className="flex items-center gap-3">
              {selectedAccount && <ModelAvatar avatarUrl={selectedAccount.avatar_thumb_url} name={selectedAccount.display_name} size={36} />}
              <SheetTitle className="text-[16px]">{selectedAccount?.display_name} — Active Chats</SheetTitle>
            </div>
            <div className="flex items-center gap-4 mt-2">
              <span className="text-[12px] text-foreground font-medium">{modelChats.length} total</span>
              <span className="text-[12px] text-amber-400">{modelChats.filter(c => c.is_unread).length} unread</span>
              <span className="text-[12px] text-orange-400">{modelChats.filter(c => chatFlagged[c.id]).length} flagged</span>
            </div>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto">
            {modelChats.map(chat => {
              const isDone = chatDone[chat.id];
              const isFlagged = chatFlagged[chat.id];
              return (
                <button key={chat.id} onClick={() => openChatSheet(chat)}
                  className={`w-full flex items-center gap-3 px-5 py-3 border-b border-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.04)] transition-colors text-left ${isDone ? "opacity-50" : ""} ${isFlagged ? "border-l-2 border-l-amber-400" : ""}`}>
                  {chat.is_unread && !isDone && <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />}
                  <FanAvatar url={chat.fan_avatar} name={chat.fan_name} size={36} />
                  <div className="flex-1 min-w-0">
                    <div className={`text-[13px] font-semibold text-foreground truncate ${isDone ? "line-through" : ""}`}>{chat.fan_name || "Unknown"}</div>
                    {chat.fan_username && <div className="text-[11px] text-muted-foreground truncate">@{(chat.fan_username || "").replace("@","")}</div>}
                    {chatNotes[chat.id] && <div className="text-[10px] text-amber-400 mt-0.5 truncate">📝 {chatNotes[chat.id]}</div>}
                    {chat.last_message_preview && <div className="text-[11px] text-muted-foreground italic truncate mt-0.5">{(chat.last_message_preview || "").slice(0, 50)}</div>}
                  </div>
                  <span className="text-[11px] text-muted-foreground shrink-0">{shortTimeAgo(chat.last_message_at)}</span>
                </button>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </DashboardLayout>
  );
}

/* ─── sub-components ─── */

function KpiCard({ icon: Icon, label, value, subtitle, color, iconBg }: {
  icon: any; label: string; value: number; subtitle: string; color: string; iconBg: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex items-start gap-3">
      <div className={`p-2.5 rounded-lg ${iconBg}`}><Icon className={`h-5 w-5 ${color}`} /></div>
      <div>
        <div className={`text-[22px] font-bold ${color}`}>{value.toLocaleString()}</div>
        <div className="text-[12px] font-medium text-foreground">{label}</div>
        <div className="text-[11px] text-muted-foreground">{subtitle}</div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex-1 bg-background/50 rounded-lg px-2 py-1.5 text-center">
      <div className={`text-[13px] font-bold ${color}`}>{value}</div>
      <div className="text-[9px] text-muted-foreground">{label}</div>
    </div>
  );
}

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <span className={`text-[11px] px-2.5 py-1 rounded-lg font-medium ${color}`}>
      {value} {label}
    </span>
  );
}

function FanAvatar({ url, name, size = 36 }: { url?: string | null; name?: string | null; size?: number }) {
  const initial = ((name || "?")[0] || "?").toUpperCase();
  if (url) {
    return <img src={url} alt="" className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />;
  }
  return (
    <span className="rounded-full bg-muted flex items-center justify-center text-muted-foreground font-bold shrink-0"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}>{initial}</span>
  );
}
