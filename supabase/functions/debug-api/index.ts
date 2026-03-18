import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const API_BASE = 'https://api.onlyfans.com'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const apiKey = Deno.env.get('ONLYFANS_API_KEY')

  // Debug endpoint — no auth required, only exposes diagnostic info (no secrets)

  const result: Record<string, any> = {
    api_key_present: !!apiKey,
    api_key_length: apiKey ? apiKey.length : 0,
    accounts_endpoint: null,
    accounts_count: 0,
    accounts_error: null,
    tracking_links_endpoint: null,
    tracking_links_count: 0,
    tracking_links_error: null,
    last_successful_sync: null,
    latest_sync_error: null,
  }

  // Fetch last successful sync and latest error from DB
  const db = createClient(supabaseUrl, serviceKey)

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

  // Test /accounts endpoint
  try {
    const accountsRes = await fetch(`${API_BASE}/accounts`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    })
    result.accounts_endpoint = {
      status: accountsRes.status,
      status_text: accountsRes.statusText,
      ok: accountsRes.ok,
    }
    if (accountsRes.ok) {
      const json = await accountsRes.json()
      const items = Array.isArray(json) ? json : (json.data ?? json.list ?? json.results ?? [])
      result.accounts_count = items.length
      // Include first account summary (no sensitive data)
      if (items.length > 0) {
        result.accounts_sample = {
          id: items[0].id ?? items[0].account_id ?? 'unknown',
          username: items[0].username ?? items[0].name ?? 'unknown',
        }
      }
    } else {
      result.accounts_error = await accountsRes.text()
    }
  } catch (err: any) {
    result.accounts_error = err.message
  }

  // Test /tracking-links endpoint (use first account if available)
  if (result.accounts_count > 0 && result.accounts_sample) {
    try {
      const tlRes = await fetch(
        `${API_BASE}/tracking-links?account_id=${result.accounts_sample.id}`,
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
        }
      )
      result.tracking_links_endpoint = {
        status: tlRes.status,
        status_text: tlRes.statusText,
        ok: tlRes.ok,
      }
      if (tlRes.ok) {
        const json = await tlRes.json()
        const items = Array.isArray(json) ? json : (json.data ?? json.list ?? json.results ?? [])
        result.tracking_links_count = items.length
      } else {
        result.tracking_links_error = await tlRes.text()
      }
    } catch (err: any) {
      result.tracking_links_error = err.message
    }
  }

  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
