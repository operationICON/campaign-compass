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

// ─── Alerts ───────────────────────────────────────────────────────────────────
export const getAlerts = (unresolvedOnly = true) =>
  apiFetch(`/alerts${buildQuery({ unresolved: unresolvedOnly ? "true" : undefined })}`);

// ─── Notifications ────────────────────────────────────────────────────────────
export const getNotifications = () => apiFetch("/notifications");
export const getUnreadCount = () => apiFetch<{ count: number }>("/notifications/unread-count");
export const markNotificationsRead = () => apiFetch("/notifications/mark-read", { method: "POST" });

// ─── Transactions ─────────────────────────────────────────────────────────────
export const getTransactions = (filters?: { account_id?: string; date_from?: string; date_to?: string }) =>
  apiFetch(`/transactions${buildQuery({ account_id: filters?.account_id, date_from: filters?.date_from, date_to: filters?.date_to })}`);

export const getTransactionTypeTotals = () => apiFetch("/transactions/type-totals");

export const getTransactionTotals = (filters?: { account_id?: string; date_from?: string }) =>
  apiFetch<{ total: number; count: number }>(`/transactions/totals${buildQuery({ account_id: filters?.account_id, date_from: filters?.date_from })}`);

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
export const getFans = (account_id?: string) =>
  apiFetch(`/fans${account_id ? `?account_id=${account_id}` : ""}`);
export const getFanCount = (account_id?: string) =>
  apiFetch<{ count: number }>(`/fans/count${account_id ? `?account_id=${account_id}` : ""}`);
export const getFanAttributionCounts = () =>
  apiFetch<Record<string, number>>("/fans/attribution-counts");
export const getFanSpenders = () => apiFetch("/fans/spenders");

// ─── Manual Notes ─────────────────────────────────────────────────────────────
export const getManualNotes = () => apiFetch("/manual-notes");
export const createManualNote = (body: any) =>
  apiFetch("/manual-notes", { method: "POST", body: JSON.stringify(body) });
export const updateManualNote = (id: string, body: any) =>
  apiFetch(`/manual-notes/${id}`, { method: "PUT", body: JSON.stringify(body) });
export const deleteManualNote = (id: string) =>
  apiFetch(`/manual-notes/${id}`, { method: "DELETE" });

// ─── Debug ────────────────────────────────────────────────────────────────────
export const debugCallEndpoint = (url: string) =>
  apiFetch("/debug", { method: "POST", body: JSON.stringify({ action: "call_endpoint", url }) });

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
