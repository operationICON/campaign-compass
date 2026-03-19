import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const API_BASE = 'https://api.onlyfansapi.com/v2'

async function apiFetchPaginated<T>(
  path: string,
  apiKey: string,
  params: Record<string, string> = {}
): Promise<T[]> {
  const allItems: T[] = []
  let offset = 0
  const limit = 100

  while (true) {
    const url = new URL(`${API_BASE}${path}`)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    url.searchParams.set('limit', String(limit))
    url.searchParams.set('offset', String(offset))

    const res = await fetch(url.toString(), {
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

    const json = await res.json()
    const items: T[] = Array.isArray(json) ? json
      : Array.isArray(json.data) ? json.data
      : Array.isArray(json.list) ? json.list
      : Array.isArray(json.results) ? json.results
      : []

    allItems.push(...items)

    if (json.has_more === true || items.length === limit) {
      offset += limit
    } else {
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

  // Create sync log entry
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

    // ── STEP 1: Fetch accounts ──
    const apiAccounts = await apiFetchPaginated<any>('/accounts', apiKey)

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

    // ── STEP 2: For each account, fetch tracking links & transactions ──
    for (const account of dbAccounts ?? []) {
      try {
        // Fetch tracking links
        const links = await apiFetchPaginated<any>(
          '/tracking-links',
          apiKey,
          { account_id: account.onlyfans_account_id }
        )

        let linkCount = 0
        for (const link of links) {
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
            url: link.url ?? link.link ?? `https://onlyfans.com/${account.onlyfans_account_id}`,
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

        // Fetch transactions
        let txCount = 0
        try {
          const transactions = await apiFetchPaginated<any>(
            '/transactions',
            apiKey,
            { account_id: account.onlyfans_account_id }
          )

          for (const tx of transactions) {
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
          // Non-fatal — log but continue
          await db.from('sync_logs').insert({
            account_id: account.id,
            status: 'error',
            success: false,
            message: `Failed /transactions: ${txErr.message}`,
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

    // Update master sync log
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
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}
