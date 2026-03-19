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

/**
 * Fetch all pages. Handles two response shapes:
 * 1. Plain array (e.g. /accounts)
 * 2. { data: { list: [...], hasMore }, _pagination: { next_page } }
 */
async function apiFetchAllPages(path: string, apiKey: string, maxPages = 5): Promise<any[]> {
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

    // Shape 1: plain array (e.g. /accounts)
    if (Array.isArray(json)) {
      allItems.push(...json)
      break
    }

    // Shape 2: { data: { list: [...] }, _pagination: { next_page } }
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

    // Upsert accounts with username from onlyfans_user_data
    for (const acc of apiAccounts) {
      const externalId = String(acc.id)
      const username = acc.onlyfans_username ?? acc.onlyfans_user_data?.username ?? null
      const displayName = acc.display_name ?? acc.onlyfans_user_data?.name ?? username ?? externalId
      await db.from('accounts').upsert({
        onlyfans_account_id: externalId,
        username: username,
        display_name: displayName,
        is_active: true,
        last_synced_at: startedAt,
      }, { onConflict: 'onlyfans_account_id' })
    }

    // Get DB accounts
    let accountsQuery = db.from('accounts').select('*').eq('is_active', true)
    if (filterAccountId) accountsQuery = accountsQuery.eq('id', filterAccountId)
    const { data: dbAccounts } = await accountsQuery

    const results: any[] = []

    // ── STEP 2: For each account, fetch tracking links + transactions ──
    for (const account of dbAccounts ?? []) {
      const acctId = account.onlyfans_account_id
      console.log(`Syncing account: ${account.display_name} (${acctId})`)
      try {
        // ── Tracking links ──
        let linkCount = 0
        try {
          const items = await apiFetchAllPages(`/${acctId}/tracking-links?limit=50`, apiKey)
          console.log(`Got ${items.length} tracking links for ${acctId}`)

          // Batch: get or create campaigns first
          const campaignNames = [...new Set(items.map((l: any) => l.campaignName ?? l.name ?? 'Unknown'))]
          const { data: existingCampaigns } = await db.from('campaigns')
            .select('id, name')
            .eq('account_id', account.id)
            .in('name', campaignNames)
          
          const campaignMap: Record<string, string> = {}
          for (const c of existingCampaigns ?? []) {
            campaignMap[c.name] = c.id
          }
          
          const missingNames = campaignNames.filter(n => !campaignMap[n])
          if (missingNames.length > 0) {
            const { data: newCampaigns } = await db.from('campaigns')
              .insert(missingNames.map(name => ({ account_id: account.id, name, status: 'active' })))
              .select('id, name')
            for (const c of newCampaigns ?? []) {
              campaignMap[c.name] = c.id
            }
          }

          for (const link of items) {
            const clicks = Number(link.clicksCount ?? 0)
            const subscribers = Number(link.subscribersCount ?? 0)
            const spenders = Number(link.revenue?.spendersCount ?? 0)
            const revenue = Number(link.revenue?.total ?? 0)
            const epc = Number(link.revenue?.revenuePerClick ?? 0)
            const rps = Number(link.revenue?.revenuePerSubscriber ?? 0)
            const convRate = clicks > 0 ? (subscribers / clicks) * 100 : 0
            const externalId = String(link.id ?? '')
            const campaignName = link.campaignName ?? link.name ?? 'Unknown'
            const campaignId = campaignMap[campaignName] ?? Object.values(campaignMap)[0]

            await db.from('tracking_links').upsert({
              external_tracking_link_id: externalId || null,
              url: link.campaignUrl ?? `https://onlyfans.com/${acctId}`,
              campaign_id: campaignId,
              campaign_name: campaignName,
              source: link.type ?? null,
              country: link.country ?? null,
              account_id: account.id,
              clicks,
              subscribers,
              spenders,
              revenue,
              revenue_per_click: epc,
              revenue_per_subscriber: rps,
              conversion_rate: convRate,
              calculated_at: link.revenue?.calculatedAt ?? startedAt,
            }, { onConflict: 'external_tracking_link_id' })
            linkCount++
          }
        } catch (metricsErr: any) {
          console.error(`Tracking links error for ${acctId}: ${metricsErr.message}`)
          await db.from('sync_logs').insert({
            account_id: account.id,
            status: 'error',
            success: false,
            message: `Failed tracking-links for ${acctId}: ${metricsErr.message}`,
            error_message: metricsErr.message,
            records_processed: 0,
          })
        }

        // ── Transactions ──
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
        } catch (txErr: any) {
          console.error(`Transactions error for ${acctId}: ${txErr.message}`)
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
