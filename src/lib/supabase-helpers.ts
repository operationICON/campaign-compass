import * as api from "./api";

export async function fetchAccounts() {
  return api.getAccounts();
}

export type TxTypeTotals = { messages: number; tips: number; subscriptions: number; posts: number };

export async function fetchTransactionTypeTotalsByAccount(): Promise<Record<string, TxTypeTotals>> {
  const rows: any[] = await api.getTransactionTypeTotals();
  const totals: Record<string, TxTypeTotals> = {};
  for (const row of rows) {
    const acctId = row.account_id as string | null;
    if (!acctId) continue;
    const rev = Number(row.revenue || 0);
    const type = row.type as string | null;
    if (!totals[acctId]) totals[acctId] = { messages: 0, tips: 0, subscriptions: 0, posts: 0 };
    if (type === "message") totals[acctId].messages += rev;
    else if (type === "tip") totals[acctId].tips += rev;
    else if (type === "new_subscription" || type === "recurring_subscription") totals[acctId].subscriptions += rev;
    else if (type === "post") totals[acctId].posts += rev;
  }
  return totals;
}

export async function fetchCampaigns() {
  return api.apiFetch("/campaigns");
}

export async function fetchTrackingLinks(filters?: {
  account_id?: string;
  campaign_id?: string;
  date_from?: string;
  date_to?: string;
}) {
  return api.getTrackingLinks({ account_id: filters?.account_id });
}

export async function fetchTransactions(filters?: {
  account_id?: string;
  date_from?: string;
  date_to?: string;
}) {
  return api.getTransactions(filters);
}

export async function fetchAdSpend(filters?: {
  campaign_id?: string;
  date_from?: string;
  date_to?: string;
}) {
  return api.getAdSpend(filters);
}

export async function fetchSyncLogs() {
  return api.getSyncLogs();
}

export async function fetchSyncLogsCount() {
  const logs: any[] = await api.getSyncLogs();
  return logs.length;
}

export async function fetchTestLogs() {
  return api.apiFetch("/test-logs");
}

export async function insertTestLog(entry: {
  run_at: string;
  test_name: string;
  status: string;
  message: string;
  response_time_ms?: number;
  account_username?: string;
}) {
  return api.apiFetch("/test-logs", { method: "POST", body: JSON.stringify(entry) });
}

export async function clearTestLogs() {
  return api.apiFetch("/test-logs", { method: "DELETE" });
}

export async function fetchDailyMetrics(trackingLinkIds?: string[]) {
  return api.getDailyMetrics(trackingLinkIds);
}

export async function fetchAlerts(unresolvedOnly = true) {
  return api.getAlerts(unresolvedOnly);
}

export async function fetchSyncSettings() {
  return api.getSyncSettings();
}

export async function updateSyncSetting(key: string, value: string) {
  return api.updateSyncSetting(key, value);
}

export async function triggerSync(
  _accountId?: string,
  _force = false,
  onProgress?: (msg: string) => void,
) {
  onProgress?.("Starting sync orchestrator...");
  const result = await api.streamSync(
    "/sync/orchestrate",
    { triggered_by: "manual" },
    (msg) => onProgress?.(msg),
  );
  onProgress?.("Sync complete!");
  return {
    accounts_synced: result?.accounts_synced ?? 0,
    tracking_links_synced: result?.tracking_links_synced ?? 0,
    errors: result?.errors,
  };
}

export async function addAdSpend(entry: {
  campaign_id: string;
  traffic_source: string;
  amount: number;
  date: string;
  notes?: string;
  media_buyer?: string;
}) {
  return api.addAdSpend(entry);
}

export async function upsertAccount(account: {
  id?: string;
  onlyfans_account_id: string;
  display_name: string;
  is_active?: boolean;
}) {
  if (account.id) {
    return api.updateAccount(account.id, account);
  }
  return api.createAccount(account);
}

export async function deleteAccount(id: string) {
  return api.deleteAccount(id);
}

export async function deleteAdSpend(id: string) {
  return api.deleteAdSpend(id);
}

export async function fetchNotifications() {
  return api.getNotifications();
}

export async function clearTrackingLinkSpend(trackingLinkId: string, _campaignId: string) {
  return api.clearTrackingLinkSpend(trackingLinkId);
}

export async function markNotificationsRead() {
  return api.markNotificationsRead();
}

export async function fetchSourceTagRules() {
  return api.getSourceTagRules();
}

export async function createSourceTagRule(rule: {
  tag_name: string;
  keywords: string[];
  color: string;
  priority: number;
}) {
  return api.createSourceTagRule(rule);
}

export async function updateSourceTagRule(id: string, updates: {
  tag_name?: string;
  keywords?: string[];
  color?: string;
  priority?: number;
}) {
  return api.updateSourceTagRule(id, updates);
}

export async function deleteSourceTagRule(id: string) {
  return api.deleteSourceTagRule(id);
}

export async function setTrackingLinkSourceTag(linkId: string, sourceTag: string, manuallyTagged = true) {
  return api.setTrackingLinkSourceTag(linkId, sourceTag, manuallyTagged);
}

export async function bulkSetSourceTag(linkIds: string[], sourceTag: string) {
  return api.bulkSetSourceTag(linkIds, sourceTag);
}

export async function fetchTrackingLinkLtv() {
  return api.getTrackingLinkLtv();
}

export async function fetchTransactionTotals(filters?: {
  account_id?: string;
  date_from?: string;
}) {
  const result = await api.getTransactionTotals(filters);
  return { totalRevenue: Number(result.total ?? 0), count: Number(result.count ?? 0) };
}

export async function fetchActiveLinkCount(accountIds?: string[]) {
  const result = await api.getActiveLinkCount(accountIds);
  return result.count;
}
