import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const API_BASE = 'https://app.onlyfansapi.com/api'

const apiHeaders = (apiKey: string) => ({
  'Authorization': `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
})

async function apiFetch(path: string, apiKey: string): Promise<any> {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`
  const res = await fetch(url, { headers: apiHeaders(apiKey) })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`API ${path} returned ${res.status}: ${body}`)
  }
  return await res.json()
}

// The API may return a plain array OR { data: [...], _pagination }
// This helper normalizes and handles pagination.
async function apiFetchAllPages(path: string, apiKey: string): Promise<any[]> {
  const allItems: any[] = []
  let currentUrl: string | null = `${API_BASE}${path}`

  while (currentUrl) {
    const res = await fetch(currentUrl, { headers: apiHeaders(apiKey) })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`API ${path} returned ${res.status}: ${body}`)
    }
    const json = await res.json()

    // Normalize: could be plain array or { data: [...] }
    if (Array.isArray(json)) {
      allItems.push(...json)
      break // plain arrays don't have pagination
    } else if (json.data && Array.isArray(json.data)) {
      allItems.push(...json.data)
      currentUrl = json._pagination?.next_page ?? null
    } else {
      // single object or unknown shape
      if (json.data) allItems.push(json.data)
      break
    }
  }

  return allItems
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const apiKey = Deno.env.get('ONLYFANS_API_KEY')

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'ONLYFANS_API_KEY is not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const db = createClient(supabaseUrl, serviceKey)
  const startedAt = new Date().toISOString()

  const { data: syncLog } = await db.from('sync_logs').insert({
    started_at: startedAt,
    status: 'running',
    success: false,
    message: 'Starting sync…',
    records_processed: 0,
  }).select().single()

  const syncLogId = syncLog?.id

  try {
    const body = await req.json().catch(() => ({}))
    const filterAccountId = body.account_id as string | undefined
    let totalRecords = 0

    // ── STEP 1: Fetch accounts (plain array response) ──
    const accountsRaw = await apiFetch('/accounts', apiKey)
    const apiAccounts: any[] = Array.isArray(accountsRaw) ? accountsRaw : (accountsRaw.data ?? [])

    if (!apiAccounts.length) {
      await updateSyncLog(db, syncLogId, {
        success: true,
        message: 'No accounts returned from API',
        records_processed: 0,
      })
      return jsonResponse({ results: [], message: 'No accounts found' })
    }

    // Upsert accounts using fields from the API response
    for (const acc of apiAccounts) {
      const externalId = String(acc.id)
      await db.from('accounts').upsert({
        onlyfans_account_id: externalId,
        username: acc.onlyfans_username ?? acc.username ?? null,
        display_name: acc.display_name ?? acc.onlyfans_username ?? externalId,
        is_active: true,
        last_synced_at: startedAt,
      }, { onConflict: 'onlyfans_account_id' })
    }

    // Get DB accounts
    let accountsQuery = db.from('accounts').select('*').eq('is_active', true)
    if (filterAccountId) accountsQuery = accountsQuery.eq('id', filterAccountId)
    const { data: dbAccounts } = await accountsQuery

    const results: any[] = []

    // ── STEP 2: For each account, fetch metrics & transactions ──
    for (const account of dbAccounts ?? []) {
      const acctId = account.onlyfans_account_id
      try {
        // ── Tracking links / sextforce metrics (paginated) ──
        let linkCount = 0
        try {
          const items = await apiFetchAllPages(
            `/${acctId}/sextforce/metrics?limit=50&offset=0`,
            apiKey
          )

          for (const link of items) {
            const clicks = Number(link.clicks ?? 0)
            const subscribers = Number(link.subscribers ?? 0)
            const spenders = Number(link.spenders ?? 0)
            const revenue = Number(link.revenue ?? 0)
            const epc = clicks > 0 ? revenue / clicks : 0
            const rps = subscribers > 0 ? revenue / subscribers : 0
            const convRate = clicks > 0 ? (subscribers / clicks) * 100 : 0
            const externalId = String(link.id ?? link.link_id ?? link.trackingId ?? '')

            await db.from('tracking_links').upsert({
              external_tracking_link_id: externalId || null,
              url: link.url ?? link.link ?? `https://onlyfans.com/${acctId}`,
              campaign_id: link.campaign_id ?? account.id,
              campaign_name: link.campaign_name ?? link.campaign ?? link.name ?? 'Unknown',
              source: link.traffic_source ?? link.source ?? null,
              country: link.country ?? link.geo ?? null,
              account_id: account.id,
              clicks,
              subscribers,
              spenders,
              revenue,
              revenue_per_click: epc,
              revenue_per_subscriber: rps,
              conversion_rate: convRate,
              calculated_at: startedAt,
            }, { onConflict: 'external_tracking_link_id' })
            linkCount++
          }
        } catch (metricsErr: any) {
          await db.from('sync_logs').insert({
            account_id: account.id,
            status: 'error',
            success: false,
            message: `Failed metrics for ${acctId}: ${metricsErr.message}`,
            error_message: metricsErr.message,
            records_processed: 0,
          })
        }

        // ── Earnings / statistics ──
        try {
          const now = new Date()
          const startDate = encodeURIComponent(`${now.getFullYear()}-01-01 00:00:00`)
          const endDate = encodeURIComponent(`${now.getFullYear()}-12-31 23:59:59`)
          await apiFetch(
            `/${acctId}/statistics/statements/earnings?start_date=${startDate}&end_date=${endDate}&type=total`,
            apiKey
          )
        } catch (_e) {
          // non-critical
        }

        // ── Latest fans (paginated) ──
        let txCount = 0
        try {
          const fanItems = await apiFetchAllPages(
            `/${acctId}/fans/latest?limit=50&offset=0`,
            apiKey
          )

          for (const tx of fanItems) {
            const externalTxId = String(tx.id ?? tx.transaction_id ?? '')
            if (!externalTxId) continue

            await db.from('transactions').upsert({
              external_transaction_id: externalTxId,
              account_id: account.id,
              user_id: tx.user_id ?? tx.userId ?? null,
              revenue: Number(tx.amount ?? tx.revenue ?? tx.total ?? 0),
              type: tx.type ?? 'fan',
              date: (tx.date ?? tx.created_at ?? tx.subscribedAt ?? startedAt).toString().split('T')[0],
            }, { onConflict: 'external_transaction_id' })
            txCount++
          }
        } catch (txErr: any) {
          await db.from('sync_logs').insert({
            account_id: account.id,
            status: 'error',
            success: false,
            message: `Failed fans/latest for ${acctId}: ${txErr.message}`,
            error_message: txErr.message,
            records_processed: 0,
          })
        }

        await db.from('accounts').update({ last_synced_at: new Date().toISOString() }).eq('id', account.id)

        totalRecords += linkCount + txCount
        results.push({
          account: account.display_name,
          status: 'success',
          links: linkCount,
          transactions: txCount,
        })
      } catch (err: any) {
        results.push({
          account: account.display_name,
          status: 'error',
          error: err.message,
        })
      }
    }

    await updateSyncLog(db, syncLogId, {
      success: results.every(r => r.status === 'success'),
      message: `Processed ${dbAccounts?.length ?? 0} accounts, ${totalRecords} records`,
      records_processed: totalRecords,
      details: { results },
    })

    return jsonResponse({ results, total_records: totalRecords })
  } catch (error: any) {
    await updateSyncLog(db, syncLogId, {
      success: false,
      message: `Fatal: ${error.message}`,
      error_message: error.message,
      details: { error: error.message, stack: error.stack },
    })

    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

async function updateSyncLog(db: any, id: string | undefined, updates: Record<string, any>) {
  if (!id) return
  await db.from('sync_logs').update({
    ...updates,
    finished_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    status: updates.success ? 'success' : 'error',
  }).eq('id', id)
}

function jsonResponse(data: any) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
