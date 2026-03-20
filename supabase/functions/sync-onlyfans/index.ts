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

async function apiFetchAllPages(path: string, apiKey: string, maxPages = 100): Promise<any[]> {
  const allItems: any[] = []
  let currentUrl: string | null = `${API_BASE}${path}`
  let page = 0

  while (currentUrl && page < maxPages) {
    page++
    console.log(`Fetching page ${page}: ${currentUrl}`)
    const res = await fetch(currentUrl, { headers: apiHeaders(apiKey) })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`API ${path} returned ${res.status}: ${body}`)
    }
    const json = await res.json()

    if (Array.isArray(json)) {
      allItems.push(...json)
      break
    }

    const data = json.data
    if (data && Array.isArray(data.list)) {
      allItems.push(...data.list)
      const nextPage = json._pagination?.next_page ?? null
      const hasMore = data.hasMore === true
      currentUrl = (hasMore && nextPage) ? nextPage : null
    } else if (data && Array.isArray(data)) {
      allItems.push(...data)
      currentUrl = json._pagination?.next_page ?? null
    } else {
      break
    }
  }

  console.log(`Fetched ${allItems.length} items from ${path} in ${page} pages`)
  return allItems
}

async function apiFetch(path: string, apiKey: string): Promise<any> {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`
  const res = await fetch(url, { headers: apiHeaders(apiKey) })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`API ${path} returned ${res.status}: ${body}`)
  }
  return await res.json()
}

async function markStuckSyncs(db: any) {
  const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000).toISOString()
  const { data: stuck } = await db.from('sync_logs')
    .select('id')
    .eq('status', 'running')
    .lt('started_at', threeMinutesAgo)

  if (stuck && stuck.length > 0) {
    const now = new Date().toISOString()
    for (const row of stuck) {
      await db.from('sync_logs').update({
        status: 'error',
        success: false,
        finished_at: now,
        completed_at: now,
        error_message: 'Sync timed out — exceeded 3 minute limit',
        message: 'Sync timed out — exceeded 3 minute limit',
      }).eq('id', row.id)

      await db.from('notifications').insert({
        type: 'sync_failed',
        message: `Sync timed out at ${now} — exceeded 3 minute limit`,
      })
    }
    console.log(`Marked ${stuck.length} stuck syncs as failed`)
  }
}

async function createNotification(db: any, type: string, message: string) {
  await db.from('notifications').insert({ type, message })
}

function calculateCostMetrics(link: any) {
  const clicks = Number(link.clicks ?? 0)
  const subscribers = Number(link.subscribers ?? 0)
  const revenue = Number(link.revenue ?? 0)
  const costType = link.cost_type
  const costValue = Number(link.cost_value ?? 0)
  const daysSinceCreated = (Date.now() - new Date(link.created_at).getTime()) / (1000 * 60 * 60 * 24)

  let cost_total = 0
  let cvr = clicks > 0 ? subscribers / clicks : 0
  let cpc_real = 0
  let cpl_real = 0
  let arpu = subscribers > 0 ? revenue / subscribers : 0

  if (costType === 'CPC') {
    cost_total = clicks * costValue
    cpc_real = costValue
    cpl_real = cvr > 0 ? costValue / cvr : 0
  } else if (costType === 'CPL') {
    cost_total = subscribers * costValue
    cpc_real = cvr > 0 ? costValue * cvr : 0
    cpl_real = costValue
  } else if (costType === 'FIXED') {
    cost_total = costValue
    cpc_real = clicks > 0 ? cost_total / clicks : 0
    cpl_real = subscribers > 0 ? cost_total / subscribers : 0
  }

  const profit = revenue - cost_total
  const roi = cost_total > 0 ? (profit / cost_total) * 100 : 0

  let status = 'NO_DATA'
  if (!costType) {
    if (clicks === 0 && daysSinceCreated >= 3) status = 'DEAD'
    else status = 'NO_DATA'
  } else {
    if (clicks === 0 && daysSinceCreated >= 3) status = 'DEAD'
    else if (roi > 150) status = 'SCALE'
    else if (roi >= 50) status = 'WATCH'
    else if (roi >= 0) status = 'LOW'
    else status = 'KILL'
  }

  return { cost_total, cvr, cpc_real, cpl_real, arpu, profit, roi, status }
}

async function recalcAllCostMetrics(db: any) {
  const { data: allLinks } = await db.from('tracking_links').select('id, clicks, subscribers, revenue, cost_type, cost_value, created_at')
  if (!allLinks || allLinks.length === 0) return

  for (const link of allLinks) {
    const metrics = calculateCostMetrics(link)
    await db.from('tracking_links').update(metrics).eq('id', link.id)
  }
  console.log(`Recalculated cost metrics for ${allLinks.length} tracking links`)
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

  await markStuckSyncs(db)

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

    // ── STEP 1: Fetch accounts ──
    const accountsRaw = await apiFetch('/accounts', apiKey)
    const apiAccounts: any[] = Array.isArray(accountsRaw) ? accountsRaw : (accountsRaw.data ?? [])

    if (!apiAccounts.length) {
      await updateSyncLog(db, syncLogId, {
        success: true,
        message: 'No accounts returned from API',
        records_processed: 0,
      })
      await createNotification(db, 'sync_success', 'Sync completed — no accounts found')
      return jsonResponse({ results: [], message: 'No accounts found' })
    }

    for (const acc of apiAccounts) {
      const ud = acc.onlyfans_user_data ?? {}
      await db.from('accounts').upsert({
        onlyfans_account_id: String(acc.id),
        username: acc.onlyfans_username ?? ud.username ?? null,
        display_name: acc.display_name ?? ud.name ?? acc.onlyfans_username ?? String(acc.id),
        is_active: true,
        last_synced_at: startedAt,
        subscribers_count: ud.subscribersCount ?? 0,
        performer_top: ud.performerTop ?? null,
        subscribe_price: ud.subscribePrice ?? 0,
        last_seen: ud.lastSeen ?? null,
      }, { onConflict: 'onlyfans_account_id' })
    }

    let accountsQuery = db.from('accounts').select('*').eq('is_active', true)
    if (filterAccountId) accountsQuery = accountsQuery.eq('id', filterAccountId)
    const { data: dbAccounts } = await accountsQuery

    const results: any[] = []

    // ── STEP 2: For each account, fetch tracking links + transactions ──
    for (const account of dbAccounts ?? []) {
      const acctId = account.onlyfans_account_id
      console.log(`Syncing account: ${account.display_name} (${acctId})`)
      try {
        let linkCount = 0
        try {
          const items = await apiFetchAllPages(`/${acctId}/tracking-links?limit=50`, apiKey)
          console.log(`Got ${items.length} tracking links for ${acctId}`)

          const campaignNames = [...new Set(items.map((l: any) => l.campaignName ?? 'Unknown'))]
          const { data: existingCampaigns } = await db.from('campaigns')
            .select('id, name').eq('account_id', account.id).in('name', campaignNames)
          const campaignMap: Record<string, string> = {}
          for (const c of existingCampaigns ?? []) campaignMap[c.name] = c.id
          const missingNames = campaignNames.filter(n => !campaignMap[n])
          if (missingNames.length > 0) {
            const { data: newC } = await db.from('campaigns')
              .insert(missingNames.map(name => ({ account_id: account.id, name, status: 'active' })))
              .select('id, name')
            for (const c of newC ?? []) campaignMap[c.name] = c.id
          }

          for (const link of items) {
            const campaignName = link.campaignName ?? 'Unknown'
            const campaignId = campaignMap[campaignName] ?? Object.values(campaignMap)[0]

            const upsertPayload: Record<string, any> = {
              external_tracking_link_id: String(link.id ?? ''),
              url: link.campaignUrl ?? `https://onlyfans.com/${acctId}`,
              campaign_id: campaignId,
              campaign_name: campaignName,
              account_id: account.id,
              clicks: Number(link.clicksCount ?? 0),
              subscribers: Number(link.subscribersCount ?? 0),
              spenders: Number(link.revenue?.spendersCount ?? 0),
              revenue: Number(link.revenue?.total ?? 0),
              revenue_per_click: Number(link.revenue?.revenuePerClick ?? 0),
              revenue_per_subscriber: Number(link.revenue?.revenuePerSubscriber ?? 0),
              conversion_rate: Number(link.clicksCount ?? 0) > 0
                ? (Number(link.subscribersCount ?? 0) / Number(link.clicksCount)) * 100 : 0,
              calculated_at: link.revenue?.calculatedAt ?? startedAt,
              source: link.type ?? null,
              country: link.country ?? null,
            }

            if (link.createdAt) {
              upsertPayload.created_at = link.createdAt
            }

            await db.from('tracking_links').upsert(upsertPayload, {
              onConflict: 'external_tracking_link_id',
              ignoreDuplicates: false,
            })
            linkCount++
          }
        } catch (err: any) {
          console.error(`Tracking links error for ${acctId}: ${err.message}`)
          await db.from('sync_logs').insert({
            account_id: account.id, status: 'error', success: false,
            message: `Failed tracking-links for ${acctId}: ${err.message}`,
            error_message: err.message, records_processed: 0,
          })
        }

        let txCount = 0
        try {
          const txItems = await apiFetchAllPages(`/${acctId}/transactions`, apiKey)
          console.log(`Got ${txItems.length} transactions for ${acctId}`)

          for (const tx of txItems) {
            const externalTxId = String(tx.id ?? '')
            if (!externalTxId) continue

            await db.from('transactions').upsert({
              external_transaction_id: externalTxId,
              account_id: account.id,
              revenue: Number(tx.amount ?? 0),
              revenue_net: Number(tx.net ?? 0),
              fee: Number(tx.fee ?? 0),
              type: tx.type ?? null,
              date: tx.createdAt ? tx.createdAt.split('T')[0] : startedAt.split('T')[0],
              fan_id: tx.user?.id ? String(tx.user.id) : null,
              fan_username: tx.user?.username ?? null,
              currency: tx.currency ?? 'USD',
              status: tx.status ?? null,
              user_id: tx.user?.id ? String(tx.user.id) : null,
            }, { onConflict: 'external_transaction_id' })
            txCount++
          }
        } catch (err: any) {
          console.error(`Transactions error for ${acctId}: ${err.message}`)
          await db.from('sync_logs').insert({
            account_id: account.id, status: 'error', success: false,
            message: `Failed transactions for ${acctId}: ${err.message}`,
            error_message: err.message, records_processed: 0,
          })
        }

        await db.from('accounts').update({ last_synced_at: new Date().toISOString() }).eq('id', account.id)
        totalRecords += linkCount + txCount
        results.push({ account: account.display_name, status: 'success', links: linkCount, transactions: txCount })
      } catch (err: any) {
        results.push({ account: account.display_name, status: 'error', error: err.message })
      }
    }

    // ── STEP 3: Recalculate cost metrics for all tracking links ──
    await recalcAllCostMetrics(db)

    // ── STEP 4: Zero-click alert check ──
    try {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
      const { data: zeroClickLinks } = await db.from('tracking_links')
        .select('id, campaign_name, account_id, clicks, created_at, accounts(display_name)')
        .eq('clicks', 0)
        .lt('created_at', threeDaysAgo)

      if (zeroClickLinks && zeroClickLinks.length > 0) {
        await db.from('alerts')
          .update({ resolved: true, resolved_at: new Date().toISOString() })
          .eq('type', 'zero_clicks')
          .eq('resolved', false)

        const alertInserts = zeroClickLinks.map((link: any) => ({
          campaign_name: link.campaign_name || 'Unknown',
          account_name: link.accounts?.display_name || 'Unknown',
          account_id: link.account_id,
          tracking_link_id: link.id,
          type: 'zero_clicks',
          message: `Campaign "${link.campaign_name}" has had 0 clicks for 3+ days`,
          resolved: false,
        }))

        await db.from('alerts').insert(alertInserts)
        console.log(`Created ${alertInserts.length} zero-click alerts`)

        await createNotification(db, 'dead_campaign', `${zeroClickLinks.length} campaigns have 0 clicks for 3+ days`)
      }
    } catch (err: any) {
      console.error(`Alert check error: ${err.message}`)
    }

    const allSuccess = results.every(r => r.status === 'success')
    await updateSyncLog(db, syncLogId, {
      success: allSuccess,
      message: `Processed ${dbAccounts?.length ?? 0} accounts, ${totalRecords} records`,
      records_processed: totalRecords,
      details: { results },
      error_message: allSuccess ? null : results.filter(r => r.status === 'error').map(r => r.error).join('; '),
    })

    await createNotification(db, 'sync_success', `Sync completed — ${totalRecords} records processed`)

    return jsonResponse({ results, total_records: totalRecords })
  } catch (error: any) {
    await updateSyncLog(db, syncLogId, {
      success: false,
      message: `Fatal: ${error.message}`,
      error_message: error.message,
      details: { error: error.message, stack: error.stack },
    })

    await createNotification(db, 'sync_failed', `Sync failed — ${error.message}`)

    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

async function updateSyncLog(db: any, id: string | undefined, updates: Record<string, any>) {
  if (!id) return
  const now = new Date().toISOString()
  await db.from('sync_logs').update({
    ...updates,
    finished_at: now,
    completed_at: now,
    status: updates.success ? 'success' : 'error',
  }).eq('id', id)
}

function jsonResponse(data: any) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
