import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const API_BASE = 'https://app.onlyfansapi.com/api'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const apiKey = Deno.env.get('ONLYFANS_API_KEY')

  const result: Record<string, any> = {
    api_key_present: !!apiKey,
    api_key_length: apiKey ? apiKey.length : 0,
    accounts_endpoint: null,
    accounts_count: 0,
    accounts_error: null,
    accounts_sample: null,
    tracking_links_endpoint: null,
    tracking_links_error: null,
    tracking_links_sample: null,
    fans_endpoint: null,
    fans_error: null,
    earnings_endpoint: null,
    earnings_error: null,
    last_successful_sync: null,
    latest_sync_error: null,
  }

  const db = createClient(supabaseUrl, serviceKey)
  const headers = apiKey ? {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  } : {}

  const { data: lastSuccess } = await db.from('sync_logs')
    .select('completed_at, message, records_processed')
    .eq('status', 'success')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  result.last_successful_sync = lastSuccess ?? null

  const { data: lastError } = await db.from('sync_logs')
    .select('started_at, completed_at, message, details')
    .eq('status', 'error')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  result.latest_sync_error = lastError ?? null

  if (!apiKey) {
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Test /accounts
  let sampleAcctId: string | null = null
  try {
    const accountsRes = await fetch(`${API_BASE}/accounts`, { headers })
    result.accounts_endpoint = { status: accountsRes.status, ok: accountsRes.ok }
    if (accountsRes.ok) {
      const json = await accountsRes.json()
      const items = Array.isArray(json) ? json : (json.data ?? [])
      result.accounts_count = items.length
      if (items.length > 0) {
        sampleAcctId = items[0].id
        result.accounts_sample = {
          id: items[0].id,
          display_name: items[0].display_name,
          onlyfans_username: items[0].onlyfans_username,
          keys: Object.keys(items[0]),
        }
      }
    } else {
      result.accounts_error = await accountsRes.text()
    }
  } catch (err: any) {
    result.accounts_error = err.message
  }

  if (sampleAcctId) {
    // Test /{id}/tracking-links?limit=5
    try {
      const r = await fetch(`${API_BASE}/${sampleAcctId}/tracking-links?limit=5`, { headers })
      result.tracking_links_endpoint = { status: r.status, ok: r.ok }
      if (r.ok) {
        const j = await r.json()
        const items = Array.isArray(j) ? j : (j.data ?? [])
        result.tracking_links_endpoint.count = items.length
        if (items.length > 0) {
          result.tracking_links_sample = {
            keys: Object.keys(items[0]),
            first: items[0],
          }
        }
      } else {
        result.tracking_links_error = await r.text()
      }
    } catch (e: any) { result.tracking_links_error = e.message }

    // Test /{id}/fans/latest?limit=5
    try {
      const r = await fetch(`${API_BASE}/${sampleAcctId}/fans/latest?limit=5`, { headers })
      result.fans_endpoint = { status: r.status, ok: r.ok }
      if (!r.ok) result.fans_error = await r.text()
    } catch (e: any) { result.fans_error = e.message }

    // Test /{id}/statistics/statements/earnings
    try {
      const year = new Date().getFullYear()
      const r = await fetch(`${API_BASE}/${sampleAcctId}/statistics/statements/earnings?start_date=${encodeURIComponent(`${year}-01-01 00:00:00`)}&end_date=${encodeURIComponent(`${year}-12-31 23:59:59`)}&type=total`, { headers })
      result.earnings_endpoint = { status: r.status, ok: r.ok }
      if (!r.ok) result.earnings_error = await r.text()
    } catch (e: any) { result.earnings_error = e.message }
  }

  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})