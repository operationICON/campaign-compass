import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { ModelAvatar } from "@/components/ModelAvatar";
import { AccountFilterDropdown } from "@/components/AccountFilterDropdown";
import { RefreshButton } from "@/components/RefreshButton";
import { Skeleton } from "@/components/ui/skeleton";
import { UserPlus, DollarSign, MessageCircle, Bell, RefreshCw, X, Info } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

/* ─── helpers ─── */
function timeAgo(dateStr: string | null) {
  if (!dateStr) return "—";
  try {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: false }) + " ago";
  } catch { return "—"; }
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
  const [accountFilter, setAccountFilter] = useState("all");
  const [timePill, setTimePill] = useState<TimePill>("day");
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

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

  // KPI filters: account dropdown + time pill
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

  // Fan lists: filtered by model pill (not account dropdown)
  const activeAccounts = useMemo(() => {
    if (selectedModelId) return accounts.filter(a => a.id === selectedModelId);
    return accounts;
  }, [accounts, selectedModelId]);

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

  const GENDER_BADGE: Record<string, string> = {
    Female: "bg-pink-500/15 text-pink-400",
    Trans: "bg-purple-500/15 text-purple-400",
    Male: "bg-blue-500/15 text-blue-400",
    Uncategorized: "bg-muted text-muted-foreground",
  };

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
            <span>
              Last updated:{" "}
              {lastUpdated ? shortTimeAgo(lastUpdated) : "—"}
            </span>
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
              Run the sync script to fetch fresh data from OnlyFans.
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
          <KpiCard
            icon={UserPlus}
            label="Total New Fans"
            value={totalNewFans}
            subtitle="Last 24 hours"
            color="text-primary"
            iconBg="bg-primary/10"
          />
          <KpiCard
            icon={DollarSign}
            label="Paid Fans"
            value={paidFans}
            subtitle={`${paidPct}% of new fans`}
            color="text-emerald-400"
            iconBg="bg-emerald-500/10"
          />
          <KpiCard
            icon={MessageCircle}
            label="Active Chats"
            value={activeChats}
            subtitle="Last 24 hours"
            color="text-blue-400"
            iconBg="bg-blue-500/10"
          />
          <KpiCard
            icon={Bell}
            label="Unread"
            value={unreadChats}
            subtitle="Need reply"
            color={unreadChats > 0 ? "text-amber-400" : "text-muted-foreground"}
            iconBg={unreadChats > 0 ? "bg-amber-500/10" : "bg-muted/50"}
          />
        </div>

        {/* MODEL PILLS */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
          {accounts.map(a => {
            const isActive = selectedModelId === a.id;
            return (
              <button
                key={a.id}
                onClick={() => setSelectedModelId(isActive ? null : a.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[12px] font-medium whitespace-nowrap transition-colors shrink-0 ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "bg-card border border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                <ModelAvatar
                  avatarUrl={a.avatar_thumb_url}
                  name={a.display_name}
                  size={28}
                />
                <span>{(a.display_name || "").split(" ")[0]}</span>
              </button>
            );
          })}
        </div>

        {/* FAN LISTS */}
        {activeAccounts.map(acc => {
          const accFans = fansByAccount[acc.id] || [];
          const accChats = chatsByAccount[acc.id] || [];
          const showHeader = !selectedModelId;

          return (
            <div key={acc.id} className="space-y-3">
              {showHeader && (
                <div className="flex items-center gap-3">
                  <ModelAvatar avatarUrl={acc.avatar_thumb_url} name={acc.display_name} size={36} />
                  <span className="text-[14px] font-bold text-foreground">{acc.display_name}</span>
                  {acc.username && (
                    <span className="text-[12px] text-muted-foreground">@{(acc.username || "").replace("@", "")}</span>
                  )}
                  {acc.gender_identity && (
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${GENDER_BADGE[acc.gender_identity] || GENDER_BADGE.Uncategorized}`}>
                      {acc.gender_identity}
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-2">
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-medium">
                      {accFans.length} new
                    </span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 font-medium">
                      {accChats.length} chats
                    </span>
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                {/* NEW FANS PANEL */}
                <FanPanel
                  title="🟢 New Fans"
                  subtitle="Subscribed in the last 24 hours"
                  count={accFans.length}
                  badgeColor="bg-emerald-500/15 text-emerald-400"
                  borderColor="border-l-emerald-500"
                  loading={fansLoading}
                  empty="No new fans in the last 24 hours"
                >
                  {accFans.map(fan => (
                    <FanRow key={fan.id}>
                      <FanAvatar url={fan.fan_avatar} name={fan.fan_name} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold text-foreground truncate">
                          {fan.fan_name || "Unknown"}
                        </div>
                        {fan.fan_username && (
                          <div className="text-[11px] text-muted-foreground truncate">
                            @{(fan.fan_username || "").replace("@", "")}
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <TimeAgoBadge dateStr={fan.subscribed_at} />
                        <div className="mt-0.5">
                          {fan.subscription_type === "Paid" ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium">
                              Paid{fan.subscribe_price ? ` $${Number(fan.subscribe_price).toFixed(2)}` : ""}
                            </span>
                          ) : (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                              Free
                            </span>
                          )}
                        </div>
                      </div>
                    </FanRow>
                  ))}
                </FanPanel>

                {/* CHATS PANEL */}
                <FanPanel
                  title="💬 Chatted"
                  subtitle="Active chats in the last 24 hours"
                  count={accChats.length}
                  badgeColor="bg-blue-500/15 text-blue-400"
                  borderColor="border-l-blue-500"
                  loading={chatsLoading}
                  empty="No chat activity in the last 24 hours"
                  emptyNote="Chat data syncs when script runs manually"
                >
                  {accChats.map(chat => (
                    <FanRow key={chat.id}>
                      <div className="relative shrink-0">
                        {chat.is_unread && (
                          <span className="absolute -left-2 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-amber-400" />
                        )}
                        <FanAvatar url={chat.fan_avatar} name={chat.fan_name} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold text-foreground truncate">
                          {chat.fan_name || "Unknown"}
                        </div>
                        {chat.fan_username && (
                          <div className="text-[11px] text-muted-foreground truncate">
                            @{(chat.fan_username || "").replace("@", "")}
                          </div>
                        )}
                        {chat.last_message_preview && (
                          <div className="text-[11px] text-muted-foreground italic truncate max-w-[250px]">
                            {(chat.last_message_preview || "").slice(0, 50)}
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-[11px] text-muted-foreground">
                          {shortTimeAgo(chat.last_message_at)}
                        </span>
                      </div>
                    </FanRow>
                  ))}
                </FanPanel>
              </div>
            </div>
          );
        })}
      </div>
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

function FanPanel({ title, subtitle, count, badgeColor, borderColor, loading, empty, emptyNote, children }: {
  title: string; subtitle: string; count: number; badgeColor: string; borderColor: string;
  loading: boolean; empty: string; emptyNote?: string; children: React.ReactNode;
}) {
  return (
    <div className={`bg-card border border-border rounded-2xl border-l-[3px] ${borderColor} overflow-hidden`}>
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-bold text-foreground">{title}</span>
          <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${badgeColor}`}>
            {count}
          </span>
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</div>
      </div>
      <div className="max-h-[500px] overflow-y-auto">
        {loading ? (
          <div className="px-4 pb-4 space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-2.5 w-16" />
                </div>
              </div>
            ))}
          </div>
        ) : count === 0 ? (
          <div className="px-4 pb-6 pt-4 text-center">
            <p className="text-[12px] text-muted-foreground">{empty}</p>
            {emptyNote && <p className="text-[11px] text-muted-foreground/60 mt-1">{emptyNote}</p>}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function FanRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-[rgba(255,255,255,0.04)] transition-colors border-t border-[rgba(255,255,255,0.06)] first:border-t-0"
      style={{ minHeight: 56 }}
    >
      {children}
    </div>
  );
}

function FanAvatar({ url, name }: { url?: string | null; name?: string | null }) {
  const initial = ((name || "?")[0] || "?").toUpperCase();
  if (url) {
    return (
      <img src={url} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
    );
  }
  return (
    <span className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-muted-foreground text-[13px] font-bold shrink-0">
      {initial}
    </span>
  );
}

function TimeAgoBadge({ dateStr }: { dateStr: string | null }) {
  if (!dateStr) return <span className="text-[11px] text-muted-foreground">—</span>;
  const ms = Date.now() - new Date(dateStr).getTime();
  const isRecent = ms < 6 * 3600_000;
  const text = shortTimeAgo(dateStr);
  return (
    <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${
      isRecent ? "bg-emerald-500/15 text-emerald-400" : "text-muted-foreground"
    }`}>
      {text}
    </span>
  );
}
