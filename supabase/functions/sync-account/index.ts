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

async function recalcCostMetrics(db: any, accountId: string) {
  const { data: allLinks } = await db.from('tracking_links')
    .select('id, clicks, subscribers, revenue, cost_type, cost_value, created_at')
    .eq('account_id', accountId)
  if (!allLinks || allLinks.length === 0) return

  // Batch update: calculate all, then update in parallel batches
  const updates = allLinks.map((link: any) => ({
    id: link.id,
    ...calculateCostMetrics(link),
  }))

  // Update in batches of 50
  for (let i = 0; i < updates.length; i += 50) {
    const batch = updates.slice(i, i + 50)
    await Promise.all(batch.map((u: any) => {
      const { id, ...metrics } = u
      return db.from('tracking_links').update(metrics).eq('id', id)
    }))
  }
  console.log(`Recalculated cost metrics for ${allLinks.length} links`)
}

async function createNotification(db: any, type: string, message: string) {
  await db.from('notifications').insert({ type, message })
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

  let body: any = {}
  try { body = await req.json() } catch {}

  const accountId = body.account_id as string
  const acctId = body.onlyfans_account_id as string
  const displayName = body.display_name as string || 'Unknown'

  if (!accountId || !acctId) {
    return new Response(
      JSON.stringify({ error: 'account_id and onlyfans_account_id are required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Create sync log for this account
  const { data: syncLog } = await db.from('sync_logs').insert({
    account_id: accountId,
    started_at: startedAt,
    status: 'running',
    success: false,
    message: `Syncing ${displayName}…`,
    records_processed: 0,
  }).select().single()

  const syncLogId = syncLog?.id

  try {
    let linkCount = 0
    let txCount = 0

    // ── Sync tracking links ──
    try {
      const items = await apiFetchAllPages(`/${acctId}/tracking-links?limit=50`, apiKey)
      console.log(`Got ${items.length} tracking links for ${displayName}`)

      // Ensure campaigns exist
      const campaignNames = [...new Set(items.map((l: any) => l.campaignName ?? 'Unknown'))]
      const { data: existingCampaigns } = await db.from('campaigns')
        .select('id, name').eq('account_id', accountId).in('name', campaignNames)
      const campaignMap: Record<string, string> = {}
      for (const c of existingCampaigns ?? []) campaignMap[c.name] = c.id
      const missingNames = campaignNames.filter(n => !campaignMap[n])
      if (missingNames.length > 0) {
        const { data: newC } = await db.from('campaigns')
          .insert(missingNames.map(name => ({ account_id: accountId, name, status: 'active' })))
          .select('id, name')
        for (const c of newC ?? []) campaignMap[c.name] = c.id
      }

      // Upsert tracking links in batches of 50
      const linkPayloads: Record<string, any>[] = []
      for (const link of items) {
        const campaignName = link.campaignName ?? 'Unknown'
        const campaignId = campaignMap[campaignName] ?? Object.values(campaignMap)[0]

        const payload: Record<string, any> = {
          external_tracking_link_id: String(link.id ?? ''),
          url: link.campaignUrl ?? `https://onlyfans.com/${acctId}`,
          campaign_id: campaignId,
          campaign_name: campaignName,
          account_id: accountId,
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
        if (link.createdAt) payload.created_at = link.createdAt
        linkPayloads.push(payload)
      }

      // Batch upsert in chunks of 50
      for (let i = 0; i < linkPayloads.length; i += 50) {
        const batch = linkPayloads.slice(i, i + 50)
        await db.from('tracking_links').upsert(batch, {
          onConflict: 'external_tracking_link_id',
          ignoreDuplicates: false,
        })
      }
      linkCount = linkPayloads.length
    } catch (err: any) {
      console.error(`Tracking links error for ${displayName}: ${err.message}`)
    }

    // ── Sync transactions (batched) ──
    try {
      const txItems = await apiFetchAllPages(`/${acctId}/transactions`, apiKey)
      console.log(`Got ${txItems.length} transactions for ${displayName}`)

      const txPayloads: Record<string, any>[] = []
      for (const tx of txItems) {
        const externalTxId = String(tx.id ?? '')
        if (!externalTxId) continue
        txPayloads.push({
          external_transaction_id: externalTxId,
          account_id: accountId,
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
        })
      }

      // Batch upsert in chunks of 100
      for (let i = 0; i < txPayloads.length; i += 100) {
        const batch = txPayloads.slice(i, i + 100)
        await db.from('transactions').upsert(batch, { onConflict: 'external_transaction_id' })
      }
      txCount = txPayloads.length
    } catch (err: any) {
      console.error(`Transactions error for ${displayName}: ${err.message}`)
    }

    // ── Recalculate cost metrics ──
    await recalcCostMetrics(db, accountId)

    // ── Update account last_synced_at ──
    await db.from('accounts').update({ last_synced_at: new Date().toISOString() }).eq('id', accountId)

    // ── Zero-click alert check for this account ──
    try {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
      const { data: zeroClickLinks } = await db.from('tracking_links')
        .select('id, campaign_name, account_id')
        .eq('account_id', accountId)
        .eq('clicks', 0)
        .lt('created_at', threeDaysAgo)

      if (zeroClickLinks && zeroClickLinks.length > 0) {
        await db.from('alerts')
          .update({ resolved: true, resolved_at: new Date().toISOString() })
          .eq('type', 'zero_clicks')
          .eq('account_id', accountId)
          .eq('resolved', false)

        const alertInserts = zeroClickLinks.map((link: any) => ({
          campaign_name: link.campaign_name || 'Unknown',
          account_name: displayName,
          account_id: accountId,
          tracking_link_id: link.id,
          type: 'zero_clicks',
          message: `Campaign "${link.campaign_name}" has had 0 clicks for 3+ days`,
          resolved: false,
        }))

        await db.from('alerts').insert(alertInserts)
      }
    } catch (err: any) {
      console.error(`Alert check error: ${err.message}`)
    }

    const totalRecords = linkCount + txCount
    const now = new Date().toISOString()

    // Update sync log
    if (syncLogId) {
      await db.from('sync_logs').update({
        status: 'success',
        success: true,
        finished_at: now,
        completed_at: now,
        message: `${displayName}: ${linkCount} links, ${txCount} transactions`,
        records_processed: totalRecords,
      }).eq('id', syncLogId)
    }

    await createNotification(db, 'sync_success', `${displayName} synced — ${totalRecords} records`)

    return new Response(JSON.stringify({
      account: displayName,
      status: 'success',
      links: linkCount,
      transactions: txCount,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    const now = new Date().toISOString()
    if (syncLogId) {
      await db.from('sync_logs').update({
        status: 'error',
        success: false,
        finished_at: now,
        completed_at: now,
        error_message: error.message,
        message: `${displayName}: ${error.message}`,
      }).eq('id', syncLogId)
    }

    await createNotification(db, 'sync_failed', `${displayName} sync failed — ${error.message}`)

    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
