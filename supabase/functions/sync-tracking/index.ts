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

function parseDurationToDays(duration: string | null | undefined): number {
  if (!duration) return 0
  const lower = duration.toLowerCase()
  const num = parseInt(lower)
  if (isNaN(num)) return 0
  if (lower.includes('year')) return num * 365
  if (lower.includes('month')) return num * 30
  if (lower.includes('week')) return num * 7
  if (lower.includes('day')) return num
  return 0
}

async function apiFetchMarkerPaginated(path: string, apiKey: string, maxPages = 200): Promise<any[]> {
  const allItems: any[] = []
  let marker: string | null = null
  let page = 0

  while (page < maxPages) {
    page++
    let url = `${API_BASE}${path}${path.includes('?') ? '&' : '?'}limit=50`
    if (marker) url += `&after=${marker}`

    const res = await fetch(url, { headers: apiHeaders(apiKey) })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`API ${path} returned ${res.status}: ${body.substring(0, 200)}`)
    }
    const json = await res.json()

    const data = json.data
    if (data && Array.isArray(data.list)) {
      allItems.push(...data.list)
      if (!data.hasMore || data.list.length === 0) break
      marker = data.list[data.list.length - 1]?.id?.toString() ?? null
      if (!marker) break
    } else if (Array.isArray(data)) {
      allItems.push(...data)
      break
    } else if (Array.isArray(json)) {
      allItems.push(...json)
      break
    } else {
      break
    }
  }

  return allItems
}

async function syncLtvForLink(db: any, apiKey: string, acctId: string, linkId: string, extId: string, accountId: string, linkCreatedAt: Date) {
  // Step 1: Fetch subscribers
  const subscribers = await apiFetchMarkerPaginated(
    `/${acctId}/tracking-links/${extId}/subscribers`,
    apiKey
  )
  console.log(`  Got ${subscribers.length} subscribers for link ${extId}`)

  for (const sub of subscribers) {
    const fanId = String(sub.id ?? sub.onlyfans_id ?? '')
    if (!fanId) continue

    const duration = sub.subscribedOnDuration ?? null
    const days = parseDurationToDays(duration)
    const subscribeDateApprox = days > 0
      ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      : null

    const { error } = await db.from('fan_attributions').upsert({
      fan_id: fanId,
      fan_username: sub.username ?? null,
      tracking_link_id: linkId,
      account_id: accountId,
      subscribed_on_duration: duration,
      subscribe_date_approx: subscribeDateApprox,
      is_active: sub.isActive ?? true,
      is_expired: sub.subscribedOnExpiredNow ?? false,
    }, { onConflict: 'fan_id,tracking_link_id', ignoreDuplicates: false })

    if (error) console.error(`  fan_attributions upsert error: ${error.message}`)
  }

  // Step 2: Fetch spenders
  const spenders = await apiFetchMarkerPaginated(
    `/${acctId}/tracking-links/${extId}/spenders`,
    apiKey
  )
  console.log(`  Got ${spenders.length} spenders for link ${extId}`)

  for (const sp of spenders) {
    const fanId = String(sp.onlyfans_id ?? sp.id ?? '')
    if (!fanId) continue

    const { error } = await db.from('fan_spend').upsert({
      fan_id: fanId,
      tracking_link_id: linkId,
      account_id: accountId,
      revenue: Number(sp.revenue?.total ?? sp.revenue ?? 0),
      calculated_at: sp.revenue?.calculated_at ?? sp.calculated_at ?? new Date().toISOString(),
    }, { onConflict: 'fan_id,tracking_link_id', ignoreDuplicates: false })

    if (error) console.error(`  fan_spend upsert error: ${error.message}`)
  }

  // Step 3: Calculate true LTV
  const { data: fanData } = await db.from('fan_attributions')
    .select('fan_id')
    .eq('tracking_link_id', linkId)
    .eq('is_expired', false)
    .gte('subscribe_date_approx', linkCreatedAt.toISOString().split('T')[0])

  const newSubFanIds = (fanData ?? []).map((f: any) => f.fan_id)
  const newSubsCount = newSubFanIds.length

  let trueLtv = 0
  let spendersCount = 0

  if (newSubFanIds.length > 0) {
    for (let i = 0; i < newSubFanIds.length; i += 200) {
      const batch = newSubFanIds.slice(i, i + 200)
      const { data: spendData } = await db.from('fan_spend')
        .select('revenue, fan_id')
        .eq('tracking_link_id', linkId)
        .in('fan_id', batch)

      for (const sp of spendData ?? []) {
        trueLtv += Number(sp.revenue || 0)
        spendersCount++
      }
    }
  }

  const ltvPerSub = newSubsCount > 0 ? trueLtv / newSubsCount : 0
  const spenderRate = newSubsCount > 0 ? (spendersCount / newSubsCount) * 100 : 0

  await db.from('tracking_links').update({
    ltv: trueLtv,
    ltv_per_sub: ltvPerSub,
    spenders_count: spendersCount,
    spender_rate: spenderRate,
  }).eq('id', linkId)

  console.log(`  Link ${extId}: LTV=$${trueLtv.toFixed(2)}, LTV/Sub=$${ltvPerSub.toFixed(2)}, Spenders=${spendersCount}/${newSubsCount}`)

  return { subscribers: subscribers.length, spenders: spenders.length, ltv: trueLtv }
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
  const testLinkId = body.test_link_id as string | undefined

  if (!accountId || !acctId) {
    return new Response(JSON.stringify({ error: 'account_id and onlyfans_account_id required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  const startedAt = new Date().toISOString()
  const { data: syncLog } = await db.from('sync_logs').insert({
    account_id: accountId, started_at: startedAt,
    status: 'running', success: false,
    message: testLinkId ? `Test sync link ${testLinkId} for ${displayName}…` : `Syncing ${displayName}…`,
    records_processed: 0,
  }).select().single()
  const syncLogId = syncLog?.id

  try {
    let linkCount = 0

    // Fetch ALL tracking link pages
    const allLinks: any[] = []
    let currentUrl: string | null = `${API_BASE}/${acctId}/tracking-links?limit=50`
    let pageNum = 0

    while (currentUrl && pageNum < 100) {
      pageNum++
      console.log(`[${displayName}] Fetching links page ${pageNum}: ${currentUrl}`)
      const res = await fetch(currentUrl, { headers: apiHeaders(apiKey) })
      if (!res.ok) {
        const errBody = await res.text()
        throw new Error(`API returned ${res.status}: ${errBody.substring(0, 200)}`)
      }
      const json = await res.json()

      if (Array.isArray(json)) { allLinks.push(...json); break }

      const data = json.data
      if (data && Array.isArray(data.list)) {
        allLinks.push(...data.list)
        const nextPage = json._pagination?.next_page ?? null
        currentUrl = (data.hasMore && nextPage) ? nextPage : null
      } else if (data && Array.isArray(data)) {
        allLinks.push(...data)
        currentUrl = json._pagination?.next_page ?? null
      } else { break }
    }

    console.log(`[${displayName}] Fetched ${allLinks.length} links in ${pageNum} pages`)

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

      // Fetch existing to preserve manual fields
      const extIds = allLinks.map((l: any) => String(l.id ?? ''))
      const existingMap: Record<string, any> = {}
      for (let i = 0; i < extIds.length; i += 200) {
        const batch = extIds.slice(i, i + 200)
        const { data: existing } = await db.from('tracking_links')
          .select('external_tracking_link_id, cost_type, cost_value, cost_total, profit, roi, cpl_real, cpc_real, cvr, arpu, source_tag, manually_tagged, status')
          .in('external_tracking_link_id', batch)
        for (const row of existing ?? []) existingMap[row.external_tracking_link_id] = row
      }

      const payloads: Record<string, any>[] = []
      for (const link of allLinks) {
        const campaignName = link.campaignName ?? 'Unknown'
        const campaignId = campaignMap[campaignName] ?? Object.values(campaignMap)[0]
        const clicks = Number(link.clicksCount ?? 0)
        const subs = Number(link.subscribersCount ?? 0)
        const rev = Number(link.revenue?.total ?? 0)
        const extId = String(link.id ?? '')
        const existing = existingMap[extId]

        const p: Record<string, any> = {
          external_tracking_link_id: extId,
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

        const hasManualCost = existing && existing.cost_type && Number(existing.cost_value || 0) > 0

        if (hasManualCost) {
          const costType = existing.cost_type
          const costValue = Number(existing.cost_value)
          let cost_total = 0, cpc_real = 0, cpl_real = 0
          const cvr = clicks > 0 ? subs / clicks : 0
          const arpu = subs > 0 ? rev / subs : 0

          if (costType === 'CPC') { cost_total = clicks * costValue; cpc_real = costValue; cpl_real = cvr > 0 ? costValue / cvr : 0 }
          else if (costType === 'CPL') { cost_total = subs * costValue; cpl_real = costValue; cpc_real = cvr > 0 ? costValue * cvr : 0 }
          else if (costType === 'FIXED') { cost_total = costValue; cpc_real = clicks > 0 ? cost_total / clicks : 0; cpl_real = subs > 0 ? cost_total / subs : 0 }

          const profit = rev - cost_total
          const roi = cost_total > 0 ? (profit / cost_total) * 100 : 0
          const daysSinceCreated = link.createdAt ? (Date.now() - new Date(link.createdAt).getTime()) / (1000 * 60 * 60 * 24) : 0
          let status = 'NO_DATA'
          if (clicks === 0 && daysSinceCreated >= 3) status = 'DEAD'
          else if (roi > 150) status = 'SCALE'
          else if (roi >= 50) status = 'WATCH'
          else if (roi >= 0) status = 'LOW'
          else status = 'KILL'
          Object.assign(p, { cost_type: costType, cost_value: costValue, cost_total, cvr, cpc_real, cpl_real, arpu, profit, roi, status })
        } else {
          const costPerSub = link.revenue?.costPerSubscriber || link.costPerSubscriber || null
          const costPerClick = link.revenue?.costPerClick || link.costPerClick || null
          const fixedCost = link.revenue?.cost || link.fixedCost || null
          if (costPerSub && Number(costPerSub) > 0) { p.cost_type = 'CPL'; p.cost_value = Number(costPerSub) }
          else if (costPerClick && Number(costPerClick) > 0) { p.cost_type = 'CPC'; p.cost_value = Number(costPerClick) }
          else if (fixedCost && Number(fixedCost) > 0) { p.cost_type = 'FIXED'; p.cost_value = Number(fixedCost) }

          const daysSinceCreated = link.createdAt ? (Date.now() - new Date(link.createdAt).getTime()) / (1000 * 60 * 60 * 24) : 0
          const cvr = clicks > 0 ? subs / clicks : 0
          const arpu = subs > 0 ? rev / subs : 0
          let cost_total = 0, cpc_real = 0, cpl_real = 0
          if (p.cost_type === 'CPC') { cost_total = clicks * (p.cost_value || 0); cpc_real = p.cost_value || 0; cpl_real = cvr > 0 ? (p.cost_value || 0) / cvr : 0 }
          else if (p.cost_type === 'CPL') { cost_total = subs * (p.cost_value || 0); cpl_real = p.cost_value || 0; cpc_real = cvr > 0 ? (p.cost_value || 0) * cvr : 0 }
          else if (p.cost_type === 'FIXED') { cost_total = p.cost_value || 0; cpc_real = clicks > 0 ? cost_total / clicks : 0; cpl_real = subs > 0 ? cost_total / subs : 0 }

          const profit = rev - cost_total
          const roi = cost_total > 0 ? (profit / cost_total) * 100 : 0
          let status = 'NO_DATA'
          if (!p.cost_type) { if (clicks === 0 && daysSinceCreated >= 3) status = 'DEAD' }
          else { if (clicks === 0 && daysSinceCreated >= 3) status = 'DEAD'; else if (roi > 150) status = 'SCALE'; else if (roi >= 50) status = 'WATCH'; else if (roi >= 0) status = 'LOW'; else status = 'KILL' }
          Object.assign(p, { cost_total, cvr, cpc_real, cpl_real, arpu, profit, roi, status })
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
      console.log(`[${displayName}] Upserted ${linkCount} links`)

      // ── Daily metrics snapshot ──
      const { data: dbLinks } = await db.from('tracking_links')
        .select('id, account_id, clicks, subscribers, revenue, external_tracking_link_id, created_at')
        .eq('account_id', accountId)
      
      const today = new Date().toISOString().split('T')[0]
      if (dbLinks) {
        const metricsPayloads = dbLinks.map((l: any) => ({
          tracking_link_id: l.id,
          account_id: l.account_id,
          date: today,
          clicks: l.clicks,
          subscribers: l.subscribers,
          revenue: l.revenue,
        }))
        for (let i = 0; i < metricsPayloads.length; i += 50) {
          await db.from('daily_metrics').upsert(
            metricsPayloads.slice(i, i + 50),
            { onConflict: 'tracking_link_id,date' }
          )
        }
        console.log(`[${displayName}] Inserted ${metricsPayloads.length} daily_metrics snapshots`)
      }

      // ── LTV Sync — only for links with clicks > 0 AND subscribers > 0 ──
      // If test_link_id provided, only sync that one link
      const linksForLtv = testLinkId
        ? allLinks.filter((l: any) => String(l.id) === testLinkId)
        : allLinks.filter((l: any) => Number(l.subscribersCount ?? 0) > 0 && Number(l.clicksCount ?? 0) > 0)

      console.log(`[${displayName}] LTV sync for ${linksForLtv.length} active links${testLinkId ? ` (test mode: ${testLinkId})` : ''}`)
      
      let ltvSyncCount = 0
      const ltvErrors: string[] = []

      for (const link of linksForLtv) {
        const extId = String(link.id ?? '')
        // Look up the DB id for this link
        const { data: dbLink } = await db.from('tracking_links')
          .select('id, created_at')
          .eq('external_tracking_link_id', extId)
          .eq('account_id', accountId)
          .single()

        if (!dbLink) {
          console.error(`  Could not find DB link for ext ${extId}`)
          continue
        }

        try {
          const result = await syncLtvForLink(
            db, apiKey, acctId,
            dbLink.id, extId, accountId,
            new Date(dbLink.created_at)
          )
          ltvSyncCount++
        } catch (err: any) {
          const msg = `Failed LTV sync for link ${extId}: ${err.message?.substring(0, 100)}`
          console.error(`  ${msg}`)
          ltvErrors.push(msg)
          // Continue to next link — never stop the whole sync
          continue
        }
      }

      console.log(`[${displayName}] LTV synced ${ltvSyncCount}/${linksForLtv.length} links`)
    }

    // Update account
    await db.from('accounts').update({ last_synced_at: new Date().toISOString() }).eq('id', accountId)

    const now = new Date().toISOString()
    if (syncLogId) {
      await db.from('sync_logs').update({
        status: 'success', success: true,
        finished_at: now, completed_at: now,
        message: testLinkId
          ? `${displayName}: test sync link ${testLinkId} complete`
          : `${displayName}: ${linkCount} links synced`,
        records_processed: linkCount,
      }).eq('id', syncLogId)
    }

    await db.from('notifications').insert({
      type: 'sync_success',
      message: `${displayName} synced — ${linkCount} links`,
    })

    return new Response(JSON.stringify({
      account: displayName, status: 'success', links: linkCount,
      test_link_id: testLinkId || null,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (error: any) {
    console.error(`[${displayName}] Error: ${error.message}`)
    const now = new Date().toISOString()
    if (syncLogId) {
      await db.from('sync_logs').update({
        status: 'error', success: false,
        finished_at: now, completed_at: now,
        error_message: error.message?.substring(0, 500),
        message: `${displayName}: ${error.message?.substring(0, 200)}`,
      }).eq('id', syncLogId)
    }
    await db.from('notifications').insert({
      type: 'sync_failed',
      message: `${displayName} sync failed — ${error.message?.substring(0, 200)}`,
    })

    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
