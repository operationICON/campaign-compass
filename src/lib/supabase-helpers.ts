import { supabase } from "@/integrations/supabase/client";

export async function fetchAccounts() {
  const { data, error } = await supabase.from("accounts").select("*").order("display_name");
  if (error) throw error;
  return data;
}

export async function fetchCampaigns() {
  const { data, error } = await supabase
    .from("campaigns")
    .select("*, accounts(display_name)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function fetchTrackingLinks(filters?: {
  account_id?: string;
  campaign_id?: string;
  date_from?: string;
  date_to?: string;
}) {
  const allData: any[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    let query = supabase
      .from("tracking_links")
      .select("*, accounts(display_name, username, avatar_thumb_url)")
      .is("deleted_at", null)
      .order("revenue", { ascending: false })
      .range(from, from + pageSize - 1);

    if (filters?.account_id) query = query.eq("account_id", filters.account_id);
    if (filters?.campaign_id) query = query.eq("campaign_id", filters.campaign_id);
    if (filters?.date_from) query = query.gte("created_at", filters.date_from);
    if (filters?.date_to) query = query.lte("created_at", filters.date_to);

    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) break;
    allData.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return allData;
}

export async function fetchTransactions(filters?: {
  account_id?: string;
  date_from?: string;
  date_to?: string;
}) {
  const allData: any[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    let query = supabase
      .from("transactions")
      .select("*")
      .order("date", { ascending: false })
      .range(from, from + pageSize - 1);

    if (filters?.account_id) query = query.eq("account_id", filters.account_id);
    if (filters?.date_from) query = query.gte("date", filters.date_from);
    if (filters?.date_to) query = query.lte("date", filters.date_to);

    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) break;
    allData.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return allData;
}

export async function fetchAdSpend(filters?: {
  campaign_id?: string;
  date_from?: string;
  date_to?: string;
}) {
  const allData: any[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    let query = supabase
      .from("ad_spend")
      .select("*, campaigns(name)")
      .order("date", { ascending: false })
      .range(from, from + pageSize - 1);

    if (filters?.campaign_id) query = query.eq("campaign_id", filters.campaign_id);
    if (filters?.date_from) query = query.gte("date", filters.date_from);
    if (filters?.date_to) query = query.lte("date", filters.date_to);

    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) break;
    allData.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return allData;
}

export async function fetchSyncLogs() {
  const allData: any[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("sync_logs")
      .select("*, accounts(display_name)")
      .order("started_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    allData.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return allData;
}

export async function fetchSyncLogsCount() {
  const { count, error } = await supabase
    .from("sync_logs")
    .select("*", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

export async function fetchTestLogs() {
  const { data, error } = await supabase
    .from("test_logs")
    .select("*")
    .order("run_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function insertTestLog(entry: {
  run_at: string;
  test_name: string;
  status: string;
  message: string;
  response_time_ms?: number;
  account_username?: string;
}) {
  const { data, error } = await supabase.from("test_logs").insert(entry).select().single();
  if (error) throw error;
  return data;
}

export async function clearTestLogs() {
  const { error } = await supabase.from("test_logs").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) throw error;
}

export async function fetchDailyMetrics(trackingLinkIds?: string[]) {
  const allData: any[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    let query = supabase
      .from("daily_metrics")
      .select("*")
      .order("date", { ascending: true })
      .range(from, from + pageSize - 1);

    if (trackingLinkIds && trackingLinkIds.length > 0) {
      query = query.in("tracking_link_id", trackingLinkIds);
    }

    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) break;
    allData.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return allData;
}

export async function fetchAlerts(unresolvedOnly = true) {
  let query = supabase
    .from("alerts")
    .select("*")
    .order("triggered_at", { ascending: false });

  if (unresolvedOnly) query = query.eq("resolved", false);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function fetchSyncSettings() {
  const { data, error } = await supabase
    .from("sync_settings")
    .select("*");
  if (error) throw error;
  return data;
}

export async function updateSyncSetting(key: string, value: string) {
  const { data, error } = await supabase
    .from("sync_settings")
    .update({ value, updated_at: new Date().toISOString() })
    .eq("key", key)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function triggerSync(
  accountId?: string,
  force = false,
  onProgress?: (msg: string) => void,
  testLinkId?: string
) {
  // Step 1: Sync accounts (fast — avatars, metadata)
  onProgress?.('Syncing accounts...');
  const orchestratorRes = await supabase.functions.invoke("sync-orchestrator", {
    body: { force },
  });
  if (orchestratorRes.error) throw orchestratorRes.error;

  const accounts = orchestratorRes.data?.accounts ?? [];
  onProgress?.(`Accounts synced (${accounts.length}). Starting link sync...`);

  // Step 2: Sync tracking links per account in parallel batches of 3
  const results: any[] = [];
  const accountsToSync = accountId
    ? accounts.filter((a: any) => a.id === accountId)
    : accounts;

  const BATCH_SIZE = 3;

  async function syncOneAccount(acc: any, index: number) {
    const label = `${acc.display_name} (${index + 1}/${accountsToSync.length})`;
    onProgress?.(`Syncing ${label}${testLinkId ? ` [test link]` : ''}...`);

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await supabase.functions.invoke("sync-tracking", {
          body: {
            account_id: acc.id,
            onlyfans_account_id: acc.onlyfans_account_id,
            display_name: acc.display_name,
            ...(testLinkId ? { test_link_id: testLinkId } : {}),
          },
        });
        results.push({ account: acc.display_name, status: 'success', data: res.data });
        return;
      } catch (err: any) {
        if (attempt === 0) {
          onProgress?.(`Retrying ${acc.display_name}...`);
          continue;
        }
        results.push({ account: acc.display_name, status: 'error', error: err.message });
      }
    }
  }

  for (let i = 0; i < accountsToSync.length; i += BATCH_SIZE) {
    const batch = accountsToSync.slice(i, i + BATCH_SIZE);
    const names = batch.map((a: any) => a.display_name).join(', ');
    onProgress?.(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${names}`);
    await Promise.all(batch.map((acc: any, j: number) => syncOneAccount(acc, i + j)));
  }

  onProgress?.('Sync complete!');
  return { results, accounts_synced: accounts.length };
}

export async function addAdSpend(entry: {
  campaign_id: string;
  traffic_source: string;
  amount: number;
  date: string;
  notes?: string;
  media_buyer?: string;
}) {
  const { data, error } = await supabase.from("ad_spend").insert(entry).select().single();
  if (error) throw error;
  return data;
}

export async function upsertAccount(account: {
  id?: string;
  onlyfans_account_id: string;
  display_name: string;
  is_active?: boolean;
}) {
  if (account.id) {
    const { data, error } = await supabase
      .from("accounts")
      .update(account)
      .eq("id", account.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase.from("accounts").insert(account).select().single();
  if (error) throw error;
  return data;
}

export async function deleteAccount(id: string) {
  const { error } = await supabase.from("accounts").delete().eq("id", id);
  if (error) throw error;
}

export async function deleteAdSpend(id: string) {
  const { error } = await supabase.from("ad_spend").delete().eq("id", id);
  if (error) throw error;
}

export async function fetchNotifications() {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  return data;
}

export async function clearTrackingLinkSpend(trackingLinkId: string, campaignId: string) {
  const { error: linkError } = await supabase.from("tracking_links").update({
    cost_type: null,
    cost_value: null,
    cost_total: null,
    profit: null,
    roi: null,
    cpl_real: null,
    cpc_real: null,
    cvr: null,
    arpu: null,
    status: "NO_SPEND",
  } as any).eq("id", trackingLinkId);
  if (linkError) throw linkError;

  await supabase.from("ad_spend").delete().eq("tracking_link_id", trackingLinkId);
}

export async function markNotificationsRead() {
  const { error } = await supabase
    .from("notifications")
    .update({ read: true })
    .eq("read", false);
  if (error) throw error;
}

// Source tag rules helpers
export async function fetchSourceTagRules() {
  const { data, error } = await supabase
    .from("source_tag_rules")
    .select("*")
    .order("priority", { ascending: true });
  if (error) throw error;
  return data;
}

export async function createSourceTagRule(rule: {
  tag_name: string;
  keywords: string[];
  color: string;
  priority: number;
}) {
  const { data, error } = await supabase.from("source_tag_rules").insert(rule).select().single();
  if (error) throw error;
  return data;
}

export async function updateSourceTagRule(id: string, updates: {
  tag_name?: string;
  keywords?: string[];
  color?: string;
  priority?: number;
}) {
  const { data, error } = await supabase.from("source_tag_rules").update(updates).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteSourceTagRule(id: string) {
  const { error } = await supabase.from("source_tag_rules").delete().eq("id", id);
  if (error) throw error;
}

export async function setTrackingLinkSourceTag(linkId: string, sourceTag: string, manuallyTagged = true) {
  const { error } = await supabase.from("tracking_links").update({
    source_tag: sourceTag,
    manually_tagged: manuallyTagged,
  } as any).eq("id", linkId);
  if (error) throw error;
}

export async function bulkSetSourceTag(linkIds: string[], sourceTag: string) {
  const { error } = await supabase.from("tracking_links").update({
    source_tag: sourceTag,
    manually_tagged: true,
  } as any).in("id", linkIds);
  if (error) throw error;
}


export async function fetchTrackingLinkLtv() {
  const allData: any[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("tracking_link_ltv")
      .select("*")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    allData.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return allData;
}

export async function fetchTransactionTotals(filters?: {
  account_id?: string;
  date_from?: string;
}) {
  let query = supabase
    .from("transactions")
    .select("revenue, account_id, date");

  if (filters?.account_id) query = query.eq("account_id", filters.account_id);
  if (filters?.date_from) query = query.gte("date", filters.date_from);

  const { data, error } = await query;
  if (error) throw error;

  const totalRevenue = (data || []).reduce((sum, tx) => sum + Number(tx.revenue || 0), 0);
  return { totalRevenue, count: (data || []).length };
}

export async function fetchActiveLinkCount(accountIds?: string[]) {
  let query = supabase
    .from("tracking_links")
    .select("*", { count: "exact", head: true })
    .is("deleted_at", null)
    .or("clicks.gt.0,subscribers.gt.0");

  if (accountIds && accountIds.length > 0) {
    query = query.in("account_id", accountIds);
  }

  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}
