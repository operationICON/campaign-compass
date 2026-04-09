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
      const nextPage = json._pagination?.next_page ?? json._meta?._pagination?.next_page ?? null
      const hasMore = data.hasMore === true
      currentUrl = (hasMore && nextPage) ? nextPage : null
    } else if (data && Array.isArray(data)) {
      allItems.push(...data)
      currentUrl = json._pagination?.next_page ?? json._meta?._pagination?.next_page ?? null
    } else {
      break
    }

    // Small delay between pages to avoid rate limiting
    await new Promise(r => setTimeout(r, 300))
  }

  console.log(`Fetched ${allItems.length} items from ${path} in ${page} pages`)
  return allItems
}

// Dedicated tracking links pagination — follows next_page until null
async function fetchAllTrackingLinks(ofAccountId: string, apiKey: string): Promise<any[]> {
  const allLinks: any[] = []
  let url: string | null = `/${ofAccountId}/tracking-links?limit=50`
  let page = 0

  while (url) {
    page++
    const fullUrl = url.startsWith('http') ? url : `${API_BASE}${url}`
    console.log(`Tracking links page ${page}: ${fullUrl}`)
    const res = await fetch(fullUrl, { headers: apiHeaders(apiKey) })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Tracking links API returned ${res.status}: ${body}`)
    }
    const json = await res.json()

    const links = json?.data?.list || []
    if (links.length === 0) break

    allLinks.push(...links)

    // Follow next_page until null — check both _pagination and _meta._pagination
    const nextPage = json?._meta?._pagination?.next_page ?? json?._pagination?.next_page ?? null
    if (nextPage) {
      try {
        const parsed = new URL(nextPage)
        url = parsed.pathname + parsed.search
      } catch {
        // If it's already a relative path
        url = nextPage
      }
    } else {
      url = null
    }

    // Small delay between pages to avoid rate limiting
    await new Promise(r => setTimeout(r, 300))
  }

  console.log(`Fetched ${allLinks.length} tracking links for ${ofAccountId} in ${page} pages`)
  return allLinks
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

// Marker-based pagination for subscribers/spenders endpoints
async function apiFetchMarkerPaginated(path: string, apiKey: string, maxPages = 200): Promise<any[]> {
  const allItems: any[] = []
  let marker: string | null = null
  let page = 0

  while (page < maxPages) {
    page++
    let url = `${API_BASE}${path}${path.includes('?') ? '&' : '?'}limit=50`
    if (marker) url += `&after=${marker}`

    console.log(`Fetching marker page ${page}: ${url}`)
    const res = await fetch(url, { headers: apiHeaders(apiKey) })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`API ${path} returned ${res.status}: ${body}`)
    }
    const json = await res.json()

    const data = json.data
    if (data && Array.isArray(data.list)) {
      allItems.push(...data.list)
      const hasMore = data.hasMore === true
      if (!hasMore || data.list.length === 0) break
      // Use last item id as marker
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

  console.log(`Fetched ${allItems.length} items from ${path} in ${page} marker pages`)
  return allItems
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

function parseDurationToDays(duration: string | null | undefined): number {
  if (!duration) return 0
  let days = 0
  const lower = duration.toLowerCase()
  const num = parseInt(lower)
  if (isNaN(num)) return 0
  if (lower.includes('year')) days = num * 365
  else if (lower.includes('month')) days = num * 30
  else if (lower.includes('week')) days = num * 7
  else if (lower.includes('day')) days = num
  return days
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
        avatar_url: ud.avatar ?? null,
        avatar_thumb_url: ud.avatarThumbs?.c144 ?? ud.avatarThumbs?.c50 ?? null,
        header_url: ud.header ?? null,
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
        const upsertedLinks: any[] = [] // Collect for LTV sync

        try {
          const items = await fetchAllTrackingLinks(acctId, apiKey)
          console.log(`Account ${account.display_name}: ${items.length} tracking links fetched`)

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

          // Fetch existing links to preserve manually-set fields
          const extIds = items.map((l: any) => String(l.id ?? ''))
          const existingMap: Record<string, any> = {}
          for (let i = 0; i < extIds.length; i += 200) {
            const batch = extIds.slice(i, i + 200)
            const { data: existing } = await db.from('tracking_links')
              .select('external_tracking_link_id, cost_type, cost_value, cost_total, profit, roi, cpl_real, cpc_real, cvr, arpu, source_tag, manually_tagged, status')
              .in('external_tracking_link_id', batch)
            for (const row of existing ?? []) {
              existingMap[row.external_tracking_link_id] = row
            }
          }

          for (const link of items) {
            const campaignName = link.campaignName ?? 'Unknown'
            const campaignId = campaignMap[campaignName] ?? Object.values(campaignMap)[0]
            const clicks = Number(link.clicksCount ?? 0)
            const subs = Number(link.subscribersCount ?? 0)
            const rev = Number(link.revenue?.total ?? 0)
            const extId = String(link.id ?? '')
            const existing = existingMap[extId]

            const upsertPayload: Record<string, any> = {
              external_tracking_link_id: extId,
              url: link.campaignUrl ?? `https://onlyfans.com/${acctId}`,
              campaign_id: campaignId,
              campaign_name: campaignName,
              account_id: account.id,
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
            if (link.createdAt) upsertPayload.created_at = link.createdAt

            // Check if this link has manually-set cost data
            const hasManualCost = existing && existing.cost_type && Number(existing.cost_value || 0) > 0
            const hasManualTag = existing && existing.source_tag && existing.source_tag !== 'Untagged'

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
              Object.assign(upsertPayload, { cost_type: costType, cost_value: costValue, cost_total, cvr, cpc_real, cpl_real, arpu, profit, roi, status })
            } else {
              const costPerSub = link.revenue?.costPerSubscriber || link.costPerSubscriber || null
              const costPerClick = link.revenue?.costPerClick || link.costPerClick || null
              const fixedCost = link.revenue?.cost || link.fixedCost || null
              let apiCostType: string | null = null, apiCostValue: number | null = null
              if (costPerSub && Number(costPerSub) > 0) { apiCostType = 'CPL'; apiCostValue = Number(costPerSub) }
              else if (costPerClick && Number(costPerClick) > 0) { apiCostType = 'CPC'; apiCostValue = Number(costPerClick) }
              else if (fixedCost && Number(fixedCost) > 0) { apiCostType = 'FIXED'; apiCostValue = Number(fixedCost) }

              if (apiCostType && apiCostValue !== null) {
                upsertPayload.cost_type = apiCostType; upsertPayload.cost_value = apiCostValue
                let cost_total = 0
                if (apiCostType === 'CPC') cost_total = clicks * apiCostValue
                else if (apiCostType === 'CPL') cost_total = subs * apiCostValue
                else cost_total = apiCostValue
                const cvr = clicks > 0 ? (subs / clicks) * 100 : 0
                const cpl_real = subs > 0 ? cost_total / subs : 0
                const cpc_real = clicks > 0 ? cost_total / clicks : 0
                const arpu = subs > 0 ? rev / subs : 0
                const profit = rev - cost_total
                const roi = cost_total > 0 ? (profit / cost_total) * 100 : 0
                const daysSinceCreated = link.createdAt ? (Date.now() - new Date(link.createdAt).getTime()) / (1000 * 60 * 60 * 24) : 0
                let status = 'NO_DATA'
                if (clicks === 0 && daysSinceCreated >= 3) status = 'DEAD'
                else if (roi > 150) status = 'SCALE'
                else if (roi >= 50) status = 'WATCH'
                else if (roi >= 0) status = 'LOW'
                else status = 'KILL'
                Object.assign(upsertPayload, { cost_total, cvr, cpc_real, cpl_real, arpu, profit, roi, status })
              }
            }

            const { data: upsertedLink } = await db.from('tracking_links').upsert(upsertPayload, {
              onConflict: 'external_tracking_link_id',
              ignoreDuplicates: false,
            }).select('id, account_id, clicks, subscribers, revenue, external_tracking_link_id, created_at').single()

            // Insert daily snapshot
            if (upsertedLink) {
              const today = new Date().toISOString().split('T')[0]
              await db.from('daily_metrics').upsert({
                tracking_link_id: upsertedLink.id,
                account_id: upsertedLink.account_id,
                date: today,
                clicks: upsertedLink.clicks,
                subscribers: upsertedLink.subscribers,
                revenue: upsertedLink.revenue,
              }, { onConflict: 'tracking_link_id,date' })

              // Collect active links for LTV sync
              if (clicks > 0 || subs > 0) {
                upsertedLinks.push({
                  ...upsertedLink,
                  extId,
                })
              }
            }

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

        // ── STEP 2b: LTV Sync — fetch subscribers & spenders for active links ──
        let ltvSyncCount = 0
        for (const ul of upsertedLinks) {
          try {
            await syncLtvForLink(db, apiKey, acctId, ul)
            ltvSyncCount++
          } catch (err: any) {
            console.error(`LTV sync error for link ${ul.external_tracking_link_id}: ${err.message}`)
          }
        }
        if (ltvSyncCount > 0) {
          console.log(`LTV synced for ${ltvSyncCount} active links in ${account.display_name}`)
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
        results.push({ account: account.display_name, status: 'success', links: linkCount, transactions: txCount, ltv_synced: ltvSyncCount })
      } catch (err: any) {
        results.push({ account: account.display_name, status: 'error', error: err.message })
      }
    }

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

// ── LTV Sync per tracking link ──
async function syncLtvForLink(db: any, apiKey: string, acctId: string, link: any) {
  const extId = link.extId || link.external_tracking_link_id
  const linkId = link.id
  const accountId = link.account_id
  const linkCreatedAt = link.created_at ? new Date(link.created_at) : new Date(0)

  // Step 1: Fetch all subscribers for this tracking link
  try {
    const subscribers = await apiFetchMarkerPaginated(
      `/${acctId}/tracking-links/${extId}/subscribers`,
      apiKey
    )
    console.log(`Got ${subscribers.length} subscribers for link ${extId}`)

    // Upsert fan_attributions
    for (const sub of subscribers) {
      const fanId = String(sub.id ?? sub.onlyfans_id ?? '')
      if (!fanId) continue

      const duration = sub.subscribedOnDuration ?? null
      const days = parseDurationToDays(duration)
      const subscribeDateApprox = days > 0
        ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        : null

      await db.from('fan_attributions').upsert({
        fan_id: fanId,
        fan_username: sub.username ?? null,
        tracking_link_id: linkId,
        account_id: accountId,
        subscribed_on_duration: duration,
        subscribe_date_approx: subscribeDateApprox,
        is_active: sub.isActive ?? true,
        is_expired: sub.subscribedOnExpiredNow ?? false,
      }, { onConflict: 'fan_id,tracking_link_id' })
    }
  } catch (err: any) {
    console.error(`Subscribers fetch error for link ${extId}: ${err.message}`)
  }

  // Step 2: Fetch all spenders for this tracking link
  try {
    const spenders = await apiFetchMarkerPaginated(
      `/${acctId}/tracking-links/${extId}/spenders`,
      apiKey
    )
    console.log(`Got ${spenders.length} spenders for link ${extId}`)

    // Upsert fan_spend
    for (const sp of spenders) {
      const fanId = String(sp.onlyfans_id ?? sp.id ?? '')
      if (!fanId) continue

      await db.from('fan_spend').upsert({
        fan_id: fanId,
        tracking_link_id: linkId,
        account_id: accountId,
        revenue: Number(sp.revenue?.total ?? sp.revenue ?? 0),
        calculated_at: sp.revenue?.calculated_at ?? sp.calculated_at ?? new Date().toISOString(),
      }, { onConflict: 'fan_id,tracking_link_id' })
    }
  } catch (err: any) {
    console.error(`Spenders fetch error for link ${extId}: ${err.message}`)
  }

  // Step 3: Calculate true LTV for this link
  try {
    // Get new subscribers (subscribed after link was created, not expired)
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
      // Get spend for these fans on this link
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

    // Update tracking_links with true LTV
    await db.from('tracking_links').update({
      ltv: trueLtv,
      ltv_per_sub: ltvPerSub,
      spenders_count: spendersCount,
      spender_rate: spenderRate,
    }).eq('id', linkId)

    console.log(`Link ${extId}: LTV=$${trueLtv.toFixed(2)}, LTV/Sub=$${ltvPerSub.toFixed(2)}, Spenders=${spendersCount}/${newSubsCount} (${spenderRate.toFixed(1)}%)`)
  } catch (err: any) {
    console.error(`LTV calculation error for link ${extId}: ${err.message}`)
  }
}

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
