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
  let query = supabase
    .from("tracking_links")
    .select("*, campaigns(name, traffic_source, country, account_id), accounts(display_name)")
    .order("created_at", { ascending: false });

  if (filters?.account_id) query = query.eq("account_id", filters.account_id);
  if (filters?.campaign_id) query = query.eq("campaign_id", filters.campaign_id);
  if (filters?.date_from) query = query.gte("created_at", filters.date_from);
  if (filters?.date_to) query = query.lte("created_at", filters.date_to);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function fetchAdSpend(filters?: {
  campaign_id?: string;
  date_from?: string;
  date_to?: string;
}) {
  let query = supabase
    .from("ad_spend")
    .select("*, campaigns(name)")
    .order("date", { ascending: false });

  if (filters?.campaign_id) query = query.eq("campaign_id", filters.campaign_id);
  if (filters?.date_from) query = query.gte("date", filters.date_from);
  if (filters?.date_to) query = query.lte("date", filters.date_to);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function fetchSyncLogs() {
  const { data, error } = await supabase
    .from("sync_logs")
    .select("*, accounts(display_name)")
    .order("started_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return data;
}

export async function triggerSync(accountId?: string) {
  const response = await supabase.functions.invoke("sync-onlyfans", {
    body: accountId ? { account_id: accountId } : {},
  });

  if (response.error) throw response.error;
  return response.data;
}

export async function addAdSpend(entry: {
  campaign_id: string;
  traffic_source: string;
  amount: number;
  date: string;
  notes?: string;
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
