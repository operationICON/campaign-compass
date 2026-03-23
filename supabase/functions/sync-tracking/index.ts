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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const apiKey = Deno.env.get('ONLYFANS_API_KEY')

  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'ONLYFANS_API_KEY not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  const db = createClient(supabaseUrl, serviceKey)
  let body: any = {}
  try { body = await req.json() } catch {}

  const accountId = body.account_id as string
  const acctId = body.onlyfans_account_id as string
  const displayName = body.display_name as string || 'Unknown'

  if (!accountId || !acctId) {
    return new Response(JSON.stringify({ error: 'account_id and onlyfans_account_id required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  const startedAt = new Date().toISOString()
  const { data: syncLog } = await db.from('sync_logs').insert({
    account_id: accountId, started_at: startedAt,
    status: 'running', success: false,
    message: `Syncing ${displayName}…`, records_processed: 0,
  }).select().single()
  const syncLogId = syncLog?.id

  try {
    let linkCount = 0

    // Fetch ALL tracking link pages — paginate within this call
    const allLinks: any[] = []
    let currentUrl: string | null = `${API_BASE}/${acctId}/tracking-links?limit=50`
    let pageNum = 0
    const maxPages = 100 // safety limit

    while (currentUrl && pageNum < maxPages) {
      pageNum++
      console.log(`[${displayName}] Fetching links page ${pageNum}: ${currentUrl}`)
      const res = await fetch(currentUrl, { headers: apiHeaders(apiKey) })
      if (!res.ok) {
        const errBody = await res.text()
        throw new Error(`API returned ${res.status}: ${errBody}`)
      }
      const json = await res.json()

      if (Array.isArray(json)) {
        allLinks.push(...json)
        break
      }

      const data = json.data
      if (data && Array.isArray(data.list)) {
        allLinks.push(...data.list)
        const nextPage = json._pagination?.next_page ?? null
        const hasMore = data.hasMore === true
        currentUrl = (hasMore && nextPage) ? nextPage : null
      } else if (data && Array.isArray(data)) {
        allLinks.push(...data)
        currentUrl = json._pagination?.next_page ?? null
      } else {
        break
      }
    }

    console.log(`[${displayName}] Fetched ${allLinks.length} links in ${pageNum} pages`)

    // Ensure campaigns exist
    if (allLinks.length > 0) {
      const campaignNames = [...new Set(allLinks.map((l: any) => l.campaignName ?? 'Unknown'))]
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

      // Build upsert payloads
      const payloads: Record<string, any>[] = []
      for (const link of allLinks) {
        const campaignName = link.campaignName ?? 'Unknown'
        const campaignId = campaignMap[campaignName] ?? Object.values(campaignMap)[0]
        const clicks = Number(link.clicksCount ?? 0)
        const subs = Number(link.subscribersCount ?? 0)
        const rev = Number(link.revenue?.total ?? 0)

        const p: Record<string, any> = {
          external_tracking_link_id: String(link.id ?? ''),
          url: link.campaignUrl ?? `https://onlyfans.com/${acctId}`,
          campaign_id: campaignId,
          campaign_name: campaignName,
          account_id: accountId,
          clicks, subscribers: subs,
          spenders: Number(link.revenue?.spendersCount ?? 0),
          revenue: rev,
          revenue_per_click: Number(link.revenue?.revenuePerClick ?? 0),
          revenue_per_subscriber: Number(link.revenue?.revenuePerSubscriber ?? 0),
          conversion_rate: clicks > 0 ? (subs / clicks) * 100 : 0,
          calculated_at: link.revenue?.calculatedAt ?? startedAt,
          source: link.type ?? null,
          country: link.country ?? null,
        }
        if (link.createdAt) p.created_at = link.createdAt

        // Extract cost from API if available
        const costPerSub = link.revenue?.costPerSubscriber || link.costPerSubscriber || null
        const costPerClick = link.revenue?.costPerClick || link.costPerClick || null
        const fixedCost = link.revenue?.cost || link.fixedCost || null

        if (costPerSub && Number(costPerSub) > 0) {
          p.cost_type = 'CPL'; p.cost_value = Number(costPerSub)
        } else if (costPerClick && Number(costPerClick) > 0) {
          p.cost_type = 'CPC'; p.cost_value = Number(costPerClick)
        } else if (fixedCost && Number(fixedCost) > 0) {
          p.cost_type = 'FIXED'; p.cost_value = Number(fixedCost)
        }

        payloads.push(p)
      }

      // Batch upsert in chunks of 25
      for (let i = 0; i < payloads.length; i += 25) {
        const batch = payloads.slice(i, i + 25)
        await db.from('tracking_links').upsert(batch, {
          onConflict: 'external_tracking_link_id', ignoreDuplicates: false,
        })
      }
      linkCount = payloads.length
    }

    // Recalculate cost metrics for this account
    const { data: allDbLinks } = await db.from('tracking_links')
      .select('id, clicks, subscribers, revenue, cost_type, cost_value, created_at')
      .eq('account_id', accountId)

    if (allDbLinks && allDbLinks.length > 0) {
      for (let i = 0; i < allDbLinks.length; i += 50) {
        const batch = allDbLinks.slice(i, i + 50)
        await Promise.all(batch.map((link: any) => {
          const metrics = calculateCostMetrics(link)
          return db.from('tracking_links').update(metrics).eq('id', link.id)
        }))
      }
      console.log(`[${displayName}] Recalculated metrics for ${allDbLinks.length} links`)
    }

    // Update account
    await db.from('accounts').update({ last_synced_at: new Date().toISOString() }).eq('id', accountId)

    const now = new Date().toISOString()
    if (syncLogId) {
      await db.from('sync_logs').update({
        status: 'success', success: true,
        finished_at: now, completed_at: now,
        message: `${displayName}: ${linkCount} links synced`,
        records_processed: linkCount,
      }).eq('id', syncLogId)
    }

    await db.from('notifications').insert({
      type: 'sync_success',
      message: `${displayName} synced — ${linkCount} links`,
    })

    return new Response(JSON.stringify({
      account: displayName, status: 'success', links: linkCount,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (error: any) {
    console.error(`[${displayName}] Error: ${error.message}`)
    const now = new Date().toISOString()
    if (syncLogId) {
      await db.from('sync_logs').update({
        status: 'error', success: false,
        finished_at: now, completed_at: now,
        error_message: error.message,
        message: `${displayName}: ${error.message}`,
      }).eq('id', syncLogId)
    }
    await db.from('notifications').insert({
      type: 'sync_failed',
      message: `${displayName} sync failed — ${error.message}`,
    })

    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
