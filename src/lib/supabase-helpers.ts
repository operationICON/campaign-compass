import { supabase } from "@/integrations/supabase/client";

export async function fetchAccounts() {
  const { data, error } = await supabase.from("accounts").select("*").order("display_name");
  if (error) throw error;
  return data;
}

/**
 * Sums transactions.revenue grouped by (account_id, type).
 * Returns a map: account_id → { messages, tips, subscriptions, posts } in dollars.
 *
 * Mapping: 'message' → messages, 'tip' → tips,
 * 'new_subscription' + 'recurring_subscription' → subscriptions,
 * 'post' → posts. Unknown types are ignored.
 */
export type TxTypeTotals = { messages: number; tips: number; subscriptions: number; posts: number };

export async function fetchTransactionTypeTotalsByAccount(): Promise<Record<string, TxTypeTotals>> {
  const totals: Record<string, TxTypeTotals> = {};
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("transactions")
      .select("account_id, type, revenue")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) {
      const acctId = (row as any).account_id as string | null;
      if (!acctId) continue;
      const rev = Number((row as any).revenue || 0);
      const type = (row as any).type as string | null;
      if (!totals[acctId]) totals[acctId] = { messages: 0, tips: 0, subscriptions: 0, posts: 0 };
      if (type === "message") totals[acctId].messages += rev;
      else if (type === "tip") totals[acctId].tips += rev;
      else if (type === "new_subscription" || type === "recurring_subscription") totals[acctId].subscriptions += rev;
      else if (type === "post") totals[acctId].posts += rev;
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return totals;
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
  // Check if a sync is already running
  const { data: runningSyncs } = await supabase
    .from('sync_logs')
    .select('id')
    .eq('status', 'running')
    .gt('started_at', new Date(Date.now() - 5 * 60 * 1000).toISOString())
    .limit(1);

  if (runningSyncs && runningSyncs.length > 0) {
    throw new Error('A sync is already in progress. Please wait.');
  }

  onProgress?.('Starting sync orchestrator...');

  // Use raw fetch for streaming SSE response from orchestrator
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const response = await fetch(`${supabaseUrl}/functions/v1/sync-orchestrator`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${supabaseKey}`,
      'apikey': supabaseKey,
    },
    body: JSON.stringify({ force, triggered_by: 'manual' }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Sync failed: ${errText}`);
  }

  // Read the SSE stream for progress updates
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let lastData: any = null;

  if (reader) {
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Parse SSE lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            lastData = data;
            if (data.message) {
              onProgress?.(data.message);
            }
          } catch {}
        }
      }
    }
  }

  onProgress?.('Sync complete!');
  return {
    accounts_synced: lastData?.accounts_synced ?? 0,
    tracking_links_synced: lastData?.tracking_links_synced ?? 0,
    errors: lastData?.errors,
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
  const allData: any[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    let query = supabase
      .from("transactions")
      .select("revenue, account_id, date")
      .range(from, from + pageSize - 1);

    if (filters?.account_id) query = query.eq("account_id", filters.account_id);
    if (filters?.date_from) query = query.gte("date", filters.date_from);

    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) break;
    allData.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  const totalRevenue = allData.reduce((sum, tx) => sum + Number(tx.revenue || 0), 0);
  return { totalRevenue, count: allData.length };
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
