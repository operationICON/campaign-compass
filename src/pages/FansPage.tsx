import { useState, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { ModelAvatar } from "@/components/ModelAvatar";
import { AccountFilterDropdown } from "@/components/AccountFilterDropdown";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { UserPlus, DollarSign, MessageCircle, Bell, RefreshCw, X, Info, Flag, Check, FileText } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

/* ─── localStorage helpers ─── */
const LS_KEY_WELCOMED = "fans_welcomed";
const LS_KEY_NOTES = "fans_notes";
const LS_KEY_DONE = "chats_done";
const LS_KEY_FLAGGED = "chats_flagged";
const LS_KEY_CHAT_NOTES = "chats_notes";

function lsGet(key: string): Record<string, any> {
  try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch { return {}; }
}
function lsSet(key: string, val: Record<string, any>) {
  localStorage.setItem(key, JSON.stringify(val));
}

/* ─── helpers ─── */
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

type ChatFilter = "all" | "unread" | "flagged" | "done";

/* ─── page ─── */
export default function FansPage() {
  const queryClient = useQueryClient();
  const [accountFilter, setAccountFilter] = useState("all");
  const [timePill, setTimePill] = useState<TimePill>("day");
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Drawer state
  const [fanDrawerAccountId, setFanDrawerAccountId] = useState<string | null>(null);
  const [chatDrawerAccountId, setChatDrawerAccountId] = useState<string | null>(null);
  const [chatDrawerFilter, setChatDrawerFilter] = useState<ChatFilter>("all");

  // localStorage state
  const [welcomed, setWelcomed] = useState<Record<string, boolean>>(lsGet(LS_KEY_WELCOMED));
  const [fanNotes, setFanNotes] = useState<Record<string, string>>(lsGet(LS_KEY_NOTES));
  const [chatDone, setChatDone] = useState<Record<string, boolean>>(lsGet(LS_KEY_DONE));
  const [chatFlagged, setChatFlagged] = useState<Record<string, boolean>>(lsGet(LS_KEY_FLAGGED));
  const [chatNotes, setChatNotes] = useState<Record<string, string>>(lsGet(LS_KEY_CHAT_NOTES));
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteInput, setNoteInput] = useState("");

  /* ─── queries ─── */
  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
      const { data } = await supabase
        .from("accounts")
        .select("id, display_name, username, avatar_thumb_url, is_active, gender_identity")
        .eq("is_active", true)
        .order("display_name");
      return data || [];
    },
  });

  const { data: newFans = [], isLoading: fansLoading } = useQuery({
    queryKey: ["chatting_team_new_fans"],
    queryFn: async () => {
      const { data } = await supabase
        .from("chatting_team_new_fans")
        .select("*")
        .order("subscribed_at", { ascending: false });
      return data || [];
    },
  });

  const { data: chats = [], isLoading: chatsLoading } = useQuery({
    queryKey: ["chatting_team_chats"],
    queryFn: async () => {
      const { data } = await supabase
        .from("chatting_team_chats")
        .select("*")
        .order("last_message_at", { ascending: false });
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

  // KPI: filtered by account dropdown
  const kpiFans = useMemo(() => {
    let f = newFans;
    if (accountFilter !== "all") f = f.filter(x => x.account_id === accountFilter);
    return f;
  }, [newFans, accountFilter]);

  const kpiChats = useMemo(() => {
    let c = chats;
    if (accountFilter !== "all") c = c.filter(x => x.account_id === accountFilter);
    return c;
  }, [chats, accountFilter]);

  const totalNewFans = kpiFans.length;
  const paidFans = kpiFans.filter(f => f.subscription_type === "Paid").length;
  const paidPct = totalNewFans > 0 ? Math.round((paidFans / totalNewFans) * 100) : 0;
  const activeChats = kpiChats.length;
  const unreadChats = kpiChats.filter(c => c.is_unread).length;

  // Fan/chat data grouped by account
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

  const accountOptions = accounts.map(a => ({
    id: a.id,
    username: a.username || a.display_name,
    display_name: a.display_name,
    avatar_thumb_url: a.avatar_thumb_url,
  }));

  // localStorage actions
  const toggleWelcomed = useCallback((fanId: string) => {
    setWelcomed(prev => {
      const next = { ...prev, [fanId]: !prev[fanId] };
      lsSet(LS_KEY_WELCOMED, next);
      return next;
    });
  }, []);

  const saveFanNote = useCallback((fanId: string, note: string) => {
    setFanNotes(prev => {
      const next = { ...prev, [fanId]: note };
      lsSet(LS_KEY_NOTES, next);
      return next;
    });
    setEditingNoteId(null);
    setNoteInput("");
  }, []);

  const toggleChatDone = useCallback((chatId: string) => {
    setChatDone(prev => {
      const next = { ...prev, [chatId]: !prev[chatId] };
      lsSet(LS_KEY_DONE, next);
      return next;
    });
  }, []);

  const toggleChatFlagged = useCallback((chatId: string) => {
    setChatFlagged(prev => {
      const next = { ...prev, [chatId]: !prev[chatId] };
      lsSet(LS_KEY_FLAGGED, next);
      return next;
    });
  }, []);

  const saveChatNote = useCallback((chatId: string, note: string) => {
    setChatNotes(prev => {
      const next = { ...prev, [chatId]: note };
      lsSet(LS_KEY_CHAT_NOTES, next);
      return next;
    });
    setEditingNoteId(null);
    setNoteInput("");
  }, []);

  // Drawer helpers
  const drawerAccount = fanDrawerAccountId
    ? accounts.find(a => a.id === fanDrawerAccountId)
    : chatDrawerAccountId
    ? accounts.find(a => a.id === chatDrawerAccountId)
    : null;

  const drawerFans = fanDrawerAccountId ? (fansByAccount[fanDrawerAccountId] || []) : [];
  const drawerChats = chatDrawerAccountId ? (chatsByAccount[chatDrawerAccountId] || []) : [];

  const filteredDrawerChats = useMemo(() => {
    if (chatDrawerFilter === "unread") return drawerChats.filter(c => c.is_unread);
    if (chatDrawerFilter === "flagged") return drawerChats.filter(c => chatFlagged[c.id]);
    if (chatDrawerFilter === "done") return drawerChats.filter(c => chatDone[c.id]);
    return drawerChats;
  }, [drawerChats, chatDrawerFilter, chatFlagged, chatDone]);

  const drawerFlaggedCount = drawerChats.filter(c => chatFlagged[c.id]).length;
  const drawerUnreadCount = drawerChats.filter(c => c.is_unread).length;

  const selectedAccount = selectedModelId ? accounts.find(a => a.id === selectedModelId) : null;

  return (
    <DashboardLayout>
      <div className="space-y-5">
        {/* HEADER */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-[22px] font-bold text-foreground">Fans</h1>
            <p className="text-[13px] text-muted-foreground mt-0.5">
              Daily fan lists for the chatting team
            </p>
          </div>
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <span>Last updated: {lastUpdated ? shortTimeAgo(lastUpdated) : "—"}</span>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="p-2 rounded-lg border border-border hover:bg-secondary transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 text-muted-foreground ${refreshing ? "animate-spin" : ""}`} />
            </button>
            {refreshing && <span className="text-primary text-[12px]">Refreshing...</span>}
          </div>
        </div>

        {/* STALE BANNER */}
        {isStale && !bannerDismissed && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-[12px] text-blue-300">
            <Info className="h-4 w-4 shrink-0 text-blue-400" />
            <span className="flex-1">
              Fan data is cached and updated manually. Click refresh to reload from the database.
            </span>
            <button onClick={() => setBannerDismissed(true)} className="p-1 hover:bg-blue-500/20 rounded">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* FILTER ROW */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <AccountFilterDropdown
            value={accountFilter}
            onChange={setAccountFilter}
            accounts={accountOptions}
          />
          <div className="flex items-center gap-1">
            {TIME_PILLS.map(p => (
              <button
                key={p.key}
                onClick={() => setTimePill(p.key)}
                className={`px-3 py-1.5 text-[12px] font-medium rounded-lg transition-colors ${
                  timePill === p.key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* KPI CARDS */}
        <div className="grid grid-cols-4 gap-4">
          <KpiCard icon={UserPlus} label="Total New Fans" value={totalNewFans}
            subtitle="Last 24 hours" color="text-primary" iconBg="bg-primary/10" />
          <KpiCard icon={DollarSign} label="Paid Fans" value={paidFans}
            subtitle={`${paidPct}% of new fans`} color="text-emerald-400" iconBg="bg-emerald-500/10" />
          <KpiCard icon={MessageCircle} label="Active Chats" value={activeChats}
            subtitle="Last 24 hours" color="text-blue-400" iconBg="bg-blue-500/10" />
          <KpiCard icon={Bell} label="Unread" value={unreadChats}
            subtitle="Need reply"
            color={unreadChats > 0 ? "text-amber-400" : "text-muted-foreground"}
            iconBg={unreadChats > 0 ? "bg-amber-500/10" : "bg-muted/50"} />
        </div>

        {/* MODEL PILLS — avatar + name vertical */}
        <div className="flex items-center gap-4 overflow-x-auto pb-2 scrollbar-thin">
          {accounts.map(a => {
            const isActive = selectedModelId === a.id;
            const firstName = (a.display_name || "").split(" ")[0];
            return (
              <button
                key={a.id}
                onClick={() => setSelectedModelId(isActive ? null : a.id)}
                className="flex flex-col items-center gap-1.5 shrink-0 transition-all"
              >
                <span className={`rounded-full p-[3px] transition-all ${
                  isActive ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : "opacity-70 hover:opacity-100"
                }`}>
                  <ModelAvatar avatarUrl={a.avatar_thumb_url} name={a.display_name} size={40} />
                </span>
                <span className={`text-[11px] font-medium transition-colors ${
                  isActive ? "text-primary" : "text-muted-foreground"
                }`}>
                  {firstName}
                </span>
              </button>
            );
          })}
        </div>

        {/* CONTENT: no model selected → overview grid */}
        {!selectedModelId ? (
          <div className="space-y-4">
            <p className="text-center text-[13px] text-muted-foreground py-2">
              Select a model above to view their fan lists
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {accounts.map(a => {
                const fCount = (fansByAccount[a.id] || []).length;
                const cCount = (chatsByAccount[a.id] || []).length;
                return (
                  <button
                    key={a.id}
                    onClick={() => setSelectedModelId(a.id)}
                    className="bg-card border border-border rounded-xl p-4 flex flex-col items-center gap-2 hover:border-primary/40 hover:-translate-y-0.5 transition-all cursor-pointer text-center"
                  >
                    <ModelAvatar avatarUrl={a.avatar_thumb_url} name={a.display_name} size={48} />
                    <span className="text-[13px] font-semibold text-foreground">{a.display_name}</span>
                    <div className="flex items-center gap-2">
                      {fCount > 0 && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-medium">
                          {fCount} new
                        </span>
                      )}
                      {cCount > 0 && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 font-medium">
                          {cCount} chats
                        </span>
                      )}
                      {fCount === 0 && cCount === 0 && (
                        <span className="text-[10px] text-muted-foreground">No activity</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          /* MODEL SELECTED → 2 col grid panels */
          <div className="grid grid-cols-2 gap-4">
            {/* NEW FANS GRID */}
            <GridPanel
              title="🟢 New Fans"
              count={(fansByAccount[selectedModelId] || []).length}
              badgeColor="bg-emerald-500/15 text-emerald-400"
              borderColor="border-l-emerald-500"
              loading={fansLoading}
              empty="No new fans in the last 24 hours"
              onViewAll={() => { setFanDrawerAccountId(selectedModelId); }}
            >
              {(fansByAccount[selectedModelId] || []).slice(0, 6).map(fan => (
                <FanCard key={fan.id}>
                  <FanAvatar url={fan.fan_avatar} name={fan.fan_name} size={44} />
                  <div className="text-[12px] font-semibold text-foreground truncate mt-1.5">
                    {fan.fan_name || "Unknown"}
                  </div>
                  {fan.fan_username && (
                    <div className="text-[10px] text-muted-foreground truncate">
                      @{(fan.fan_username || "").replace("@", "")}
                    </div>
                  )}
                  <div className="flex items-center justify-between w-full mt-1.5">
                    {fan.subscription_type === "Paid" ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium">
                        Paid{fan.subscribe_price ? ` $${Number(fan.subscribe_price).toFixed(0)}` : ""}
                      </span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                        Free
                      </span>
                    )}
                    <TimeAgoBadge dateStr={fan.subscribed_at} />
                  </div>
                </FanCard>
              ))}
            </GridPanel>

            {/* CHATS GRID */}
            <GridPanel
              title="💬 Chatted"
              count={(chatsByAccount[selectedModelId] || []).length}
              badgeColor="bg-blue-500/15 text-blue-400"
              borderColor="border-l-blue-500"
              loading={chatsLoading}
              empty="No chat activity in the last 24 hours"
              onViewAll={() => { setChatDrawerAccountId(selectedModelId); setChatDrawerFilter("all"); }}
            >
              {(chatsByAccount[selectedModelId] || []).slice(0, 6).map(chat => (
                <FanCard key={chat.id}>
                  <div className="relative">
                    <FanAvatar url={chat.fan_avatar} name={chat.fan_name} size={44} />
                    {chat.is_unread && (
                      <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-amber-400 border-2 border-card" />
                    )}
                  </div>
                  <div className="text-[12px] font-semibold text-foreground truncate mt-1.5">
                    {chat.fan_name || "Unknown"}
                  </div>
                  {chat.fan_username && (
                    <div className="text-[10px] text-muted-foreground truncate">
                      @{(chat.fan_username || "").replace("@", "")}
                    </div>
                  )}
                  {chat.last_message_preview && (
                    <div className="text-[10px] text-muted-foreground italic truncate w-full mt-0.5">
                      {(chat.last_message_preview || "").slice(0, 30)}
                    </div>
                  )}
                  <div className="mt-1">
                    <span className="text-[10px] text-muted-foreground">{shortTimeAgo(chat.last_message_at)}</span>
                  </div>
                </FanCard>
              ))}
            </GridPanel>
          </div>
        )}
      </div>

      {/* ─── NEW FANS DRAWER ─── */}
      <Sheet open={!!fanDrawerAccountId} onOpenChange={(o) => { if (!o) setFanDrawerAccountId(null); }}>
        <SheetContent side="right" className="w-[480px] sm:max-w-[480px] p-0 flex flex-col">
          <SheetHeader className="px-5 pt-5 pb-3 border-b border-border">
            <div className="flex items-center gap-3">
              {drawerAccount && <ModelAvatar avatarUrl={drawerAccount.avatar_thumb_url} name={drawerAccount.display_name} size={36} />}
              <SheetTitle className="text-[16px]">
                {drawerAccount?.display_name} — New Fans (last 24h)
              </SheetTitle>
            </div>
            {/* summary stats */}
            <div className="flex items-center gap-4 mt-2">
              <span className="text-[12px] text-foreground font-medium">{drawerFans.length} total</span>
              <span className="text-[12px] text-emerald-400">{drawerFans.filter(f => f.subscription_type === "Paid").length} paid</span>
              <span className="text-[12px] text-muted-foreground">{drawerFans.filter(f => f.subscription_type !== "Paid").length} free</span>
            </div>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto">
            {drawerFans.map(fan => (
              <div key={fan.id}
                className={`flex items-center gap-3 px-5 py-3 border-b border-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.04)] transition-colors ${
                  welcomed[fan.id] ? "opacity-60" : ""
                }`}
              >
                <FanAvatar url={fan.fan_avatar} name={fan.fan_name} size={36} />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-foreground truncate">
                    {fan.fan_name || "Unknown"}
                    {welcomed[fan.id] && <span className="ml-2 text-[10px] text-emerald-400">✓ Welcomed</span>}
                  </div>
                  {fan.fan_username && (
                    <div className="text-[11px] text-muted-foreground truncate">@{(fan.fan_username || "").replace("@", "")}</div>
                  )}
                  {fanNotes[fan.id] && (
                    <div className="text-[10px] text-amber-400 mt-0.5 truncate">📝 {fanNotes[fan.id]}</div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <TimeAgoBadge dateStr={fan.subscribed_at} />
                  {fan.subscription_type === "Paid" ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium">
                      Paid{fan.subscribe_price ? ` $${Number(fan.subscribe_price).toFixed(0)}` : ""}
                    </span>
                  ) : (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">Free</span>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0 ml-1">
                  <button
                    onClick={() => toggleWelcomed(fan.id)}
                    className={`h-7 px-2 text-[10px] rounded border transition-colors ${
                      welcomed[fan.id]
                        ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10"
                        : "border-border text-muted-foreground hover:text-foreground hover:border-primary/30"
                    }`}
                  >
                    👋
                  </button>
                  <button
                    onClick={() => {
                      if (editingNoteId === fan.id) { setEditingNoteId(null); setNoteInput(""); }
                      else { setEditingNoteId(fan.id); setNoteInput(fanNotes[fan.id] || ""); }
                    }}
                    className="h-7 px-2 text-[10px] rounded border border-border text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors"
                  >
                    📝
                  </button>
                </div>
              </div>
            ))}
            {/* Inline note editor */}
            {editingNoteId && fanDrawerAccountId && (
              <div className="sticky bottom-0 bg-card border-t border-border px-5 py-3 flex items-center gap-2">
                <input
                  autoFocus
                  value={noteInput}
                  onChange={e => setNoteInput(e.target.value)}
                  placeholder="Add note..."
                  className="flex-1 h-8 px-3 text-[12px] rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary"
                  onKeyDown={e => { if (e.key === "Enter") saveFanNote(editingNoteId, noteInput); }}
                />
                <button
                  onClick={() => saveFanNote(editingNoteId, noteInput)}
                  className="h-8 px-3 text-[11px] rounded-lg bg-primary text-primary-foreground font-medium"
                >
                  Save
                </button>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* ─── CHATS DRAWER ─── */}
      <Sheet open={!!chatDrawerAccountId} onOpenChange={(o) => { if (!o) setChatDrawerAccountId(null); }}>
        <SheetContent side="right" className="w-[480px] sm:max-w-[480px] p-0 flex flex-col">
          <SheetHeader className="px-5 pt-5 pb-3 border-b border-border">
            <div className="flex items-center gap-3">
              {drawerAccount && <ModelAvatar avatarUrl={drawerAccount.avatar_thumb_url} name={drawerAccount.display_name} size={36} />}
              <SheetTitle className="text-[16px]">
                {drawerAccount?.display_name} — Active Chats (last 24h)
              </SheetTitle>
            </div>
            <div className="flex items-center gap-4 mt-2">
              <span className="text-[12px] text-foreground font-medium">{drawerChats.length} total</span>
              <span className="text-[12px] text-amber-400">{drawerUnreadCount} unread</span>
              <span className="text-[12px] text-orange-400">{drawerFlaggedCount} flagged</span>
            </div>
            {/* Filter pills */}
            <div className="flex items-center gap-1 mt-2">
              {(["all", "unread", "flagged", "done"] as ChatFilter[]).map(f => (
                <button
                  key={f}
                  onClick={() => setChatDrawerFilter(f)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition-colors capitalize ${
                    chatDrawerFilter === f
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  {f} {f === "unread" ? `(${drawerUnreadCount})` : f === "flagged" ? `(${drawerFlaggedCount})` : ""}
                </button>
              ))}
            </div>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto">
            {filteredDrawerChats.map(chat => {
              const isDone = chatDone[chat.id];
              const isFlagged = chatFlagged[chat.id];
              return (
                <div key={chat.id}
                  className={`flex items-center gap-3 px-5 py-3 border-b border-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.04)] transition-colors ${
                    isDone ? "opacity-50" : ""
                  } ${isFlagged ? "border-l-2 border-l-amber-400" : ""}`}
                >
                  {chat.is_unread && !isDone && (
                    <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                  )}
                  <FanAvatar url={chat.fan_avatar} name={chat.fan_name} size={36} />
                  <div className="flex-1 min-w-0">
                    <div className={`text-[13px] font-semibold text-foreground truncate ${isDone ? "line-through" : ""}`}>
                      {chat.fan_name || "Unknown"}
                    </div>
                    {chat.fan_username && (
                      <div className="text-[11px] text-muted-foreground truncate">@{(chat.fan_username || "").replace("@", "")}</div>
                    )}
                    {chatNotes[chat.id] && (
                      <div className="text-[10px] text-amber-400 mt-0.5 truncate">📝 {chatNotes[chat.id]}</div>
                    )}
                    {chat.last_message_preview && (
                      <div className="text-[11px] text-muted-foreground italic truncate mt-0.5">
                        {(chat.last_message_preview || "").slice(0, 50)}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-[11px] text-muted-foreground">{shortTimeAgo(chat.last_message_at)}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-1">
                    <button
                      onClick={() => toggleChatDone(chat.id)}
                      className={`h-7 px-2 text-[10px] rounded border transition-colors ${
                        isDone
                          ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10"
                          : "border-border text-muted-foreground hover:text-foreground hover:border-primary/30"
                      }`}
                      title="Mark done"
                    >
                      ✓
                    </button>
                    <button
                      onClick={() => {
                        if (editingNoteId === chat.id) { setEditingNoteId(null); setNoteInput(""); }
                        else { setEditingNoteId(chat.id); setNoteInput(chatNotes[chat.id] || ""); }
                      }}
                      className="h-7 px-2 text-[10px] rounded border border-border text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors"
                      title="Add note"
                    >
                      📝
                    </button>
                    <button
                      onClick={() => toggleChatFlagged(chat.id)}
                      className={`h-7 px-2 text-[10px] rounded border transition-colors ${
                        isFlagged
                          ? "border-amber-500/30 text-amber-400 bg-amber-500/10"
                          : "border-border text-muted-foreground hover:text-foreground hover:border-amber-500/30"
                      }`}
                      title="Flag for follow up"
                    >
                      ⚑
                    </button>
                  </div>
                </div>
              );
            })}
            {filteredDrawerChats.length === 0 && (
              <div className="px-5 py-8 text-center text-[12px] text-muted-foreground">
                No chats match this filter
              </div>
            )}
            {/* Inline note editor */}
            {editingNoteId && chatDrawerAccountId && (
              <div className="sticky bottom-0 bg-card border-t border-border px-5 py-3 flex items-center gap-2">
                <input
                  autoFocus
                  value={noteInput}
                  onChange={e => setNoteInput(e.target.value)}
                  placeholder="Add note..."
                  className="flex-1 h-8 px-3 text-[12px] rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary"
                  onKeyDown={e => { if (e.key === "Enter" && editingNoteId) saveChatNote(editingNoteId, noteInput); }}
                />
                <button
                  onClick={() => { if (editingNoteId) saveChatNote(editingNoteId, noteInput); }}
                  className="h-8 px-3 text-[11px] rounded-lg bg-primary text-primary-foreground font-medium"
                >
                  Save
                </button>
              </div>
            )}
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
      <div className={`p-2.5 rounded-lg ${iconBg}`}>
        <Icon className={`h-5 w-5 ${color}`} />
      </div>
      <div>
        <div className={`text-[22px] font-bold ${color}`}>{value.toLocaleString()}</div>
        <div className="text-[12px] font-medium text-foreground">{label}</div>
        <div className="text-[11px] text-muted-foreground">{subtitle}</div>
      </div>
    </div>
  );
}

function GridPanel({ title, count, badgeColor, borderColor, loading, empty, onViewAll, children }: {
  title: string; count: number; badgeColor: string; borderColor: string;
  loading: boolean; empty: string; onViewAll: () => void; children: React.ReactNode;
}) {
  return (
    <div className={`bg-card border border-border rounded-2xl border-l-[3px] ${borderColor} overflow-hidden`}>
      <div className="px-4 pt-4 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-bold text-foreground">{title}</span>
          <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${badgeColor}`}>{count}</span>
        </div>
      </div>
      {loading ? (
        <div className="px-4 pb-4 grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="flex flex-col items-center gap-2 p-3">
              <Skeleton className="h-11 w-11 rounded-full" />
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-2.5 w-12" />
            </div>
          ))}
        </div>
      ) : count === 0 ? (
        <div className="px-4 pb-6 pt-4 text-center">
          <p className="text-[12px] text-muted-foreground">{empty}</p>
        </div>
      ) : (
        <>
          <div className="px-4 pb-3 grid grid-cols-2 gap-2.5">
            {children}
          </div>
          {count > 6 && (
            <button
              onClick={onViewAll}
              className="w-full py-2.5 text-[12px] font-medium text-primary hover:bg-primary/5 transition-colors border-t border-border"
            >
              View all {count} →
            </button>
          )}
          {count <= 6 && count > 0 && (
            <button
              onClick={onViewAll}
              className="w-full py-2.5 text-[12px] font-medium text-primary hover:bg-primary/5 transition-colors border-t border-border"
            >
              View all →
            </button>
          )}
        </>
      )}
    </div>
  );
}

function FanCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center p-3 rounded-xl border border-border bg-background/50 hover:-translate-y-0.5 hover:border-primary/20 transition-all text-center">
      {children}
    </div>
  );
}

function FanAvatar({ url, name, size = 36 }: { url?: string | null; name?: string | null; size?: number }) {
  const initial = ((name || "?")[0] || "?").toUpperCase();
  if (url) {
    return (
      <img src={url} alt="" className="rounded-full object-cover shrink-0"
        style={{ width: size, height: size }} />
    );
  }
  return (
    <span className="rounded-full bg-muted flex items-center justify-center text-muted-foreground font-bold shrink-0"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}>
      {initial}
    </span>
  );
}

function TimeAgoBadge({ dateStr }: { dateStr: string | null }) {
  if (!dateStr) return <span className="text-[10px] text-muted-foreground">—</span>;
  const ms = Date.now() - new Date(dateStr).getTime();
  const isRecent = ms < 6 * 3600_000;
  return (
    <span className={`text-[10px] font-medium ${
      isRecent ? "text-emerald-400" : "text-muted-foreground"
    }`}>
      {shortTimeAgo(dateStr)}
    </span>
  );
}
