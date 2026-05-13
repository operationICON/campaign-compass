const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

function getToken(): string | null {
  try { return localStorage.getItem("ct_token"); } catch { return null; }
}

export async function apiFetch<T = any>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
export const authLogin = (email: string, password: string) =>
  apiFetch<{ token: string; user: { id: string; email: string; role: string; name: string } }>(
    "/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }
  );
export const authMe = () => apiFetch<{ user: { id: string; email: string; role: string; name: string } }>("/auth/me");
export const getUsers = () => apiFetch<any[]>("/auth/users");
export const createUser = (body: { email: string; password: string; name: string; role: string }) =>
  apiFetch("/auth/users", { method: "POST", body: JSON.stringify(body) });
export const updateUser = (id: string, body: { name?: string; role?: string; password?: string }) =>
  apiFetch(`/auth/users/${id}`, { method: "PUT", body: JSON.stringify(body) });
export const deleteUser = (id: string) =>
  apiFetch(`/auth/users/${id}`, { method: "DELETE" });

function buildQuery(params: Record<string, string | string[] | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) v.forEach(s => q.append(k, s));
    else q.append(k, v);
  }
  const str = q.toString();
  return str ? `?${str}` : "";
}

// ─── Accounts ────────────────────────────────────────────────────────────────
export const getAccounts = () => apiFetch("/accounts");
export const getAccount = (id: string) => apiFetch(`/accounts/${id}`);
export const createAccount = (body: any) => apiFetch("/accounts", { method: "POST", body: JSON.stringify(body) });
export const updateAccount = (id: string, body: any) => apiFetch(`/accounts/${id}`, { method: "PUT", body: JSON.stringify(body) });
export const deleteAccount = (id: string) => apiFetch(`/accounts/${id}`, { method: "DELETE" });

// ─── Tracking Links ───────────────────────────────────────────────────────────
export const getTrackingLinks = (filters?: { account_id?: string; deleted?: boolean }) =>
  apiFetch(`/tracking-links${buildQuery({ account_id: filters?.account_id, deleted: filters?.deleted ? "true" : undefined })}`);

export const getTrackingLink = (id: string) => apiFetch(`/tracking-links/${id}`);

export const createTrackingLink = (body: any) =>
  apiFetch("/tracking-links", { method: "POST", body: JSON.stringify(body) });

export const updateTrackingLink = (id: string, body: any) =>
  apiFetch(`/tracking-links/${id}`, { method: "PUT", body: JSON.stringify(body) });

export const setTrackingLinkSourceTag = (id: string, source_tag: string, manually_tagged = true) =>
  apiFetch(`/tracking-links/${id}/source-tag`, { method: "PATCH", body: JSON.stringify({ source_tag, manually_tagged }) });

export const bulkSetSourceTag = (ids: string[], source_tag: string) =>
  apiFetch("/tracking-links/bulk-source-tag", { method: "PATCH", body: JSON.stringify({ ids, source_tag }) });

export const clearTrackingLinkSpend = (id: string) =>
  apiFetch(`/tracking-links/${id}/clear-spend`, { method: "PATCH" });

export const deleteTrackingLink = (id: string) =>
  apiFetch(`/tracking-links/${id}`, { method: "DELETE" });

export const restoreTrackingLink = (id: string) =>
  apiFetch(`/tracking-links/${id}/restore`, { method: "POST" });

export const getActiveLinkCount = (account_ids?: string[]) =>
  apiFetch<{ count: number }>(`/tracking-links/active-count${account_ids?.length ? buildQuery({ account_id: account_ids }) : ""}`);

// ─── Sync Logs ────────────────────────────────────────────────────────────────
export const getSyncLogs = () => apiFetch("/sync-logs");

export const getSyncLogsByAccount = (accountId: string) =>
  apiFetch(`/sync-logs${buildQuery({ account_id: accountId })}`);

// ─── Alerts ───────────────────────────────────────────────────────────────────
export const getAlerts = (unresolvedOnly = true) =>
  apiFetch(`/alerts${buildQuery({ unresolved: unresolvedOnly ? "true" : undefined })}`);

// ─── Notifications ────────────────────────────────────────────────────────────
export const getNotifications = () => apiFetch("/notifications");
export const getUnreadCount = () => apiFetch<{ count: number }>("/notifications/unread-count");
export const markNotificationsRead = () => apiFetch("/notifications/mark-read", { method: "POST" });

// ─── Transactions ─────────────────────────────────────────────────────────────
export const getTransactions = (filters?: {
  account_id?: string;
  date_from?: string;
  date_to?: string;
  tracking_link_id?: string;
  limit?: number;
}) =>
  apiFetch(`/transactions${buildQuery({
    account_id:       filters?.account_id,
    date_from:        filters?.date_from,
    date_to:          filters?.date_to,
    tracking_link_id: filters?.tracking_link_id,
    limit:            filters?.limit?.toString(),
  })}`);

export const getTransactionTypeTotals = () => apiFetch("/transactions/type-totals");

export const getTransactionsByMonth = (account_id: string) =>
  apiFetch<Array<{ month: string; type: string | null; revenue: number; tx_count: number }>>(`/transactions/by-month?account_id=${account_id}`);

export const getTransactionsByDay = (account_id: string) =>
  apiFetch<Array<{ day: string; type: string | null; revenue: number; tx_count: number }>>(`/transactions/by-day?account_id=${account_id}`);

export const getTransactionTotals = (filters?: { account_id?: string; date_from?: string }) =>
  apiFetch<{ total: number; count: number }>(`/transactions/totals${buildQuery({ account_id: filters?.account_id, date_from: filters?.date_from })}`);

export const getTransactionDaily = (params: { date_from?: string; date_to?: string; account_ids?: string[] }) =>
  apiFetch<Array<{ account_id: string; date: string; revenue: string }>>(
    `/transactions/daily${buildQuery({
      date_from:   params.date_from,
      date_to:     params.date_to,
      account_ids: params.account_ids?.join(","),
    })}`
  );

export const getTransactionAttributionBreakdown = (params: { date_from?: string; date_to?: string; account_ids?: string[] }) =>
  apiFetch<{
    total_revenue: number;
    campaign_revenue: number;
    unattributed_revenue: number;
    by_type: Array<{ type: string; total_revenue: number; campaign_revenue: number; unattributed_revenue: number; tx_count: number }>;
  }>(`/transactions/attribution-breakdown${buildQuery({
    date_from:   params.date_from,
    date_to:     params.date_to,
    account_ids: params.account_ids?.join(","),
  })}`);

// ─── Daily Metrics ────────────────────────────────────────────────────────────
export const getDailyMetrics = (tracking_link_ids?: string[]) =>
  apiFetch(`/daily-metrics${tracking_link_ids?.length ? buildQuery({ ids: tracking_link_ids }) : ""}`);

// ─── Daily Snapshots ──────────────────────────────────────────────────────────
export const getDailySnapshots = (params?: { ids?: string[]; date_from?: string; date_to?: string }) =>
  apiFetch(`/daily-snapshots${buildQuery({ ids: params?.ids, date_from: params?.date_from, date_to: params?.date_to })}`);

// ─── Tracking Link LTV ────────────────────────────────────────────────────────
export const getTrackingLinkLtv = () => apiFetch("/tracking-link-ltv");

// ─── Traffic Sources ──────────────────────────────────────────────────────────
export const getTrafficSources = () => apiFetch("/traffic-sources");
export const createTrafficSource = (body: any) => apiFetch("/traffic-sources", { method: "POST", body: JSON.stringify(body) });
export const updateTrafficSource = (id: string, body: any) => apiFetch(`/traffic-sources/${id}`, { method: "PUT", body: JSON.stringify(body) });
export const deleteTrafficSource = (id: string) => apiFetch(`/traffic-sources/${id}`, { method: "DELETE" });

// ─── Source Tag Rules ─────────────────────────────────────────────────────────
export const getSourceTagRules = () => apiFetch("/source-tag-rules");
export const createSourceTagRule = (body: any) => apiFetch("/source-tag-rules", { method: "POST", body: JSON.stringify(body) });
export const updateSourceTagRule = (id: string, body: any) => apiFetch(`/source-tag-rules/${id}`, { method: "PUT", body: JSON.stringify(body) });
export const deleteSourceTagRule = (id: string) => apiFetch(`/source-tag-rules/${id}`, { method: "DELETE" });

// ─── Sync Settings ────────────────────────────────────────────────────────────
export const getSyncSettings = () => apiFetch("/sync-settings");
export const updateSyncSetting = (key: string, value: string) =>
  apiFetch(`/sync-settings/${key}`, { method: "PUT", body: JSON.stringify({ value }) });

// ─── Ad Spend ─────────────────────────────────────────────────────────────────
export const getAdSpend = (filters?: { campaign_id?: string; date_from?: string; date_to?: string }) =>
  apiFetch(`/ad-spend${buildQuery({ campaign_id: filters?.campaign_id, date_from: filters?.date_from, date_to: filters?.date_to })}`);
export const addAdSpend = (body: any) => apiFetch("/ad-spend", { method: "POST", body: JSON.stringify(body) });
export const deleteAdSpend = (id: string) => apiFetch(`/ad-spend/${id}`, { method: "DELETE" });

// ─── Campaigns ───────────────────────────────────────────────────────────────
export const getCampaigns = () => apiFetch("/campaigns");
export const createCampaign = (body: any) => apiFetch("/campaigns", { method: "POST", body: JSON.stringify(body) });
export const updateCampaign = (id: string, body: any) => apiFetch(`/campaigns/${id}`, { method: "PUT", body: JSON.stringify(body) });
export const deleteCampaign = (id: string) => apiFetch(`/campaigns/${id}`, { method: "DELETE" });

// ─── Daily Snapshots extended ─────────────────────────────────────────────────
export const getSnapshotLatestDate = (account_id?: string) =>
  apiFetch<{ date: string | null }>(`/daily-snapshots/latest-date${account_id ? `?account_id=${account_id}` : ""}`);
export const getSnapshotEarliestDate = () =>
  apiFetch<{ date: string | null }>("/daily-snapshots/earliest-date");
export const getSnapshotDistinctDates = (limit = 10) =>
  apiFetch<string[]>(`/daily-snapshots/distinct-dates?limit=${limit}`);
export const getSnapshotAllTimeTotals = (account_ids?: string[]) =>
  apiFetch<{ revenue: number; subscribers: number }>(
    `/daily-snapshots/alltime-totals${account_ids?.length ? `?account_ids=${account_ids.join(",")}` : ""}`
  );

export const getLinkSubsInPeriod = (params: { account_ids: string[]; date_from?: string | null; date_to?: string | null }) =>
  apiFetch<Array<{ tracking_link_id: string; account_id: string; subs: number }>>(
    `/daily-snapshots/link-subs${buildQuery({ account_ids: params.account_ids.join(","), date_from: params.date_from ?? undefined, date_to: params.date_to ?? undefined })}`
  );

export const getSnapshotsByDateRange = (params: {
  date_from?: string;
  date_to?: string;
  account_ids?: string[];
  tracking_link_ids?: string[];
  cols?: "slim";
}) =>
  apiFetch(`/daily-snapshots${buildQuery({
    date_from: params.date_from,
    date_to: params.date_to,
    account_ids: params.account_ids?.join(","),
    tracking_link_ids: params.tracking_link_ids?.join(","),
    cols: params.cols,
  })}`);

// ─── OnlyTraffic Orders ────────────────────────────────────────────────────────
export const getOnlytrafficOrders = (params?: {
  tracking_link_ids?: string[];
  date_from?: string;
  date_to?: string;
  statuses?: string[];
  active_only?: boolean;
  marketer?: string;
  offer_id?: string;
}) =>
  apiFetch(`/onlytraffic-orders${buildQuery({
    tracking_link_ids: params?.tracking_link_ids?.join(","),
    date_from: params?.date_from,
    date_to: params?.date_to,
    statuses: params?.statuses?.join(","),
    active_only: params?.active_only ? "true" : undefined,
    marketer: params?.marketer,
    offer_id: params?.offer_id,
  })}`);
export const getUnmatchedOrders = () => apiFetch("/onlytraffic-orders/unmatched");

// ─── Tracking Link bulk update ────────────────────────────────────────────────
export const bulkUpdateTrackingLinks = (updates: { id: string; [key: string]: any }[]) =>
  apiFetch("/tracking-links/bulk-update", { method: "POST", body: JSON.stringify(updates) });

// ─── Fans ─────────────────────────────────────────────────────────────────────
export const getFanStats = (params?: { account_id?: string }) =>
  apiFetch<{
    total_fans: number; spenders: number; total_revenue: number;
    avg_per_spender: number; cross_poll_fans: number; cross_poll_revenue: number;
  }>(`/fans/stats${buildQuery({ account_id: params?.account_id })}`);

export const getFans = (params?: {
  account_id?: string; tracking_link_id?: string; search?: string; date_from?: string; date_to?: string;
  spenders_only?: boolean; cross_poll_only?: boolean;
  limit?: number; offset?: number; sort_by?: string; sort_dir?: string;
}) =>
  apiFetch<{ fans: any[]; total: number; limit: number; offset: number }>(`/fans${buildQuery({
    account_id: params?.account_id,
    tracking_link_id: params?.tracking_link_id,
    search: params?.search,
    date_from: params?.date_from,
    date_to: params?.date_to,
    spenders_only: params?.spenders_only ? "true" : undefined,
    cross_poll_only: params?.cross_poll_only ? "true" : undefined,
    limit: params?.limit?.toString(),
    offset: params?.offset?.toString(),
    sort_by: params?.sort_by,
    sort_dir: params?.sort_dir,
  })}`);

export const getFanSpendersBreakdown = (params?: {
  account_id?: string; tracking_link_id?: string; search?: string; limit?: number;
}) =>
  apiFetch<{ rows: any[]; total: number }>(`/fans/spenders-breakdown${buildQuery({
    account_id: params?.account_id,
    tracking_link_id: params?.tracking_link_id,
    search: params?.search,
    limit: params?.limit?.toString(),
  })}`);

export const getFan = (id: string) =>
  apiFetch<{ fan: any; account_stats: any[]; transactions: any[] }>(`/fans/${id}`);

export const getCrossPollFans = (limit = 200) =>
  apiFetch<Array<{
    id: string; fan_id: string; username: string | null; display_name: string | null;
    avatar_url: string | null; total_revenue: number; first_subscribe_link_id: string | null;
    first_subscribe_date: string | null; acquired_via_account_id: string | null;
    account_ids: string[]; account_count: number;
    per_account_revenue: Array<{ account_id: string; revenue: number; tx_count: number }>;
  }>>(`/fans/cross-poll?limit=${limit}`);

export const getCrossPollBreakdown = (tracking_link_id: string) =>
  apiFetch<Array<{
    dest_account_id: string; dest_account_name: string; dest_avatar_url: string | null;
    fans_count: number; revenue: number;
  }>>(`/fans/cross-poll-breakdown?tracking_link_id=${tracking_link_id}`);

export const getCrossPollDetail = (params?: { limit?: number; source_account_id?: string; dest_account_id?: string }) => {
  const q = new URLSearchParams();
  if (params?.limit)             q.set("limit", String(params.limit));
  if (params?.source_account_id) q.set("source_account_id", params.source_account_id);
  if (params?.dest_account_id)   q.set("dest_account_id", params.dest_account_id);
  const qs = q.toString();
  return apiFetch<Array<{
    fan_id: string; username: string | null; tracking_link_id: string | null;
    campaign_name: string | null; campaign_url: string | null;
    source_account_id: string; source_account_name: string;
    dest_account_id: string; dest_account_name: string;
    revenue: number;
  }>>(`/fans/cross-poll-detail${qs ? "?" + qs : ""}`);
};

export const updateFan = (id: string, body: { tags?: string[]; notes?: string; status?: string }) =>
  apiFetch(`/fans/${id}`, { method: "PATCH", body: JSON.stringify(body) });

export const getFanCount = (account_id?: string) =>
  apiFetch<{ count: number }>(`/fans/count${account_id ? `?account_id=${account_id}` : ""}`);

export const getFanCampaignBreakdown = (params: { account_ids: string[]; date_from?: string | null; date_to?: string | null }) =>
  apiFetch<Array<{ account_id: string; link_id: string; campaign_name: string | null; external_tracking_link_id: string | null; link_deleted: boolean; fan_count: number }>>(
    `/fans/campaign-breakdown${buildQuery({ account_ids: params.account_ids.join(","), date_from: params.date_from ?? undefined, date_to: params.date_to ?? undefined })}`
  );

// kept for backward compat — components that import these legacy names
export const getFanSpenders = () => apiFetch("/fans/spenders");
export const getFanAttributionCounts = () =>
  apiFetch<Record<string, number>>("/fans/attribution-counts");

// ─── Manual Notes ─────────────────────────────────────────────────────────────
export const getManualNotes = () => apiFetch("/manual-notes");
export const createManualNote = (body: any) =>
  apiFetch("/manual-notes", { method: "POST", body: JSON.stringify(body) });
export const updateManualNote = (id: string, body: any) =>
  apiFetch(`/manual-notes/${id}`, { method: "PUT", body: JSON.stringify(body) });
export const deleteManualNote = (id: string) =>
  apiFetch(`/manual-notes/${id}`, { method: "DELETE" });

// ─── Campaign Analytics ───────────────────────────────────────────────────────
export const getCampaignAnalyticsList = (account_id?: string) =>
  apiFetch<any[]>(`/tracking-links${account_id ? `?account_id=${account_id}` : ""}`);

export const getCampaignRevenueByType = (account_id?: string) =>
  apiFetch<Array<{
    tracking_link_id: string;
    total_revenue: string;
    new_sub_revenue: string;
    resub_revenue: string;
    tip_revenue: string;
    message_revenue: string;
    post_revenue: string;
  }>>(`/campaign-analytics/revenue-by-type${account_id ? `?account_id=${account_id}` : ""}`);

export const getCampaignRevenueByGroup = (account_id?: string) =>
  apiFetch<Array<{
    group_key: string;
    campaign_name: string;
    total_revenue: string;
  }>>(`/campaign-analytics/revenue-by-campaign${account_id ? `?account_id=${account_id}` : ""}`);

export const getCampaignTrend = (id: string, days = 30) =>
  apiFetch<any[]>(`/campaign-analytics/${id}/trend?days=${days}`);

export const getCampaignSpenders = (id: string, limit = 500) =>
  apiFetch<{ rows: any[]; total: number }>(`/campaign-analytics/${id}/spenders?limit=${limit}`);

export const getCampaignCohortArps = (
  id: string,
  params: { acq_start?: string; acq_end?: string; revenue_basis?: "net" | "gross" } = {}
) =>
  apiFetch<{
    cohort_size: number; total_source_subs: number; coverage: number;
    arps_48h: number; arps_7d: number; arps_14d: number; arps_21d: number; arps_30d: number; arps_all_time: number;
    rev_48h: number; rev_7d: number; rev_14d: number; rev_21d: number; rev_30d: number; rev_all_time: number;
    curve: { period: string; days: number; revenue: number; arps: number }[];
  }>(
    `/campaign-analytics/${id}/cohort-arps${buildQuery({
      acq_start: params.acq_start,
      acq_end: params.acq_end,
      revenue_basis: params.revenue_basis,
    })}`
  );

// ─── Debug ────────────────────────────────────────────────────────────────────
export const debugCallEndpoint = (url: string) =>
  apiFetch("/debug", { method: "POST", body: JSON.stringify({ action: "call_endpoint", url }) });

export const debugAction = (action: string, extra: Record<string, any> = {}) =>
  apiFetch("/debug", { method: "POST", body: JSON.stringify({ action, ...extra }) });

// ─── SSE Sync helpers ─────────────────────────────────────────────────────────
export async function streamSync(
  path: string,
  body: object,
  onProgress: (msg: string) => void,
  signal?: AbortSignal,
): Promise<any> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sync failed: ${text || res.statusText}`);
  }
  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  let lastData: any = null;
  if (reader) {
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const data = JSON.parse(line.slice(6));
          lastData = data;
          if (data.message) onProgress(data.message);
        } catch {}
      }
    }
  }
  return lastData;
}

// ─── Revenue Snapshots (ground-truth OF earnings totals) ──────────────────────
export const getRevenueSnapshots = () =>
  apiFetch<{
    grand_total_net: number;
    grand_total_gross: number;
    last_synced_at: string | null;
    account_count: number;
    accounts: Array<{
      account_id: string;
      display_name: string;
      username: string;
      net_total: string;
      gross_total: string;
      last_synced_at: string;
      api_status: number;
    }>;
  }>("/revenue-snapshots");

export const syncRevenueSnapshots = () =>
  apiFetch("/revenue-snapshots/sync", { method: "POST" });

export const getRevenuePeriod = (dateFrom: string, dateTo: string) =>
  apiFetch<{ account_id: string; net: number }[]>(
    `/revenue-snapshots/period?date_from=${dateFrom}&date_to=${dateTo}`
  );
