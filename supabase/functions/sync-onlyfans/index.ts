import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const API_BASE = 'https://app.onlyfansapi.com/api'

async function apiFetch<T>(path: string, apiKey: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`API ${path} returned ${res.status}: ${body}`)
  }

  return await res.json() as T
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

    // ── STEP 1: Fetch accounts from API ──
    const apiAccounts = await apiFetch<any[]>('/accounts', apiKey)

    if (!apiAccounts.length) {
      await updateSyncLog(db, syncLogId, {
        success: true,
        message: 'No accounts returned from API',
        records_processed: 0,
      })
      return jsonResponse({ results: [], message: 'No accounts found' })
    }

    // Upsert accounts
    for (const acc of apiAccounts) {
      const externalId = String(acc.id ?? acc.account_id ?? acc.userId)
      await db.from('accounts').upsert({
        onlyfans_account_id: externalId,
        username: acc.username ?? acc.name ?? null,
        display_name: acc.name ?? acc.username ?? externalId,
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
        // Fetch tracking/metrics via /{account_id}/sextforce/metrics
        let linkCount = 0
        try {
          const metrics = await apiFetch<any>(`/${acctId}/sextforce/metrics`, apiKey)
          const items = Array.isArray(metrics) ? metrics : (metrics.data ?? metrics.list ?? metrics.results ?? [])

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

        // Fetch transactions via /{account_id}/payouts/transactions
        let txCount = 0
        try {
          const transactions = await apiFetch<any>(`/${acctId}/payouts/transactions`, apiKey)
          const txItems = Array.isArray(transactions) ? transactions : (transactions.data ?? transactions.list ?? transactions.results ?? [])

          for (const tx of txItems) {
            const externalTxId = String(tx.id ?? tx.transaction_id ?? '')
            if (!externalTxId) continue

            await db.from('transactions').upsert({
              external_transaction_id: externalTxId,
              account_id: account.id,
              user_id: tx.user_id ?? null,
              revenue: Number(tx.amount ?? tx.revenue ?? 0),
              type: tx.type ?? null,
              date: (tx.date ?? tx.created_at ?? startedAt).split('T')[0],
            }, { onConflict: 'external_transaction_id' })
            txCount++
          }
        } catch (txErr: any) {
          await db.from('sync_logs').insert({
            account_id: account.id,
            status: 'error',
            success: false,
            message: `Failed transactions for ${acctId}: ${txErr.message}`,
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
