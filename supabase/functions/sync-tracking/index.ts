import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const API_BASE = 'https://api.onlyfans.com'

// Generic paginated fetch — handles cursor-based and offset-based pagination
async function apiFetch<T>(
  path: string,
  apiKey: string,
  params: Record<string, string> = {}
): Promise<T[]> {
  const allItems: T[] = []
  let cursor: string | undefined
  let offset = 0
  const limit = 100

  while (true) {
    const url = new URL(`${API_BASE}${path}`)
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v)
    }
    url.searchParams.set('limit', String(limit))
    if (cursor) {
      url.searchParams.set('cursor', cursor)
    } else if (offset > 0) {
      url.searchParams.set('offset', String(offset))
    }

    const res = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    })

    if (!res.ok) {
      const errorBody = await res.text()
      throw new Error(
        `OnlyFans API ${path} returned HTTP ${res.status}: ${errorBody}`
      )
    }

    const json = await res.json()

    // Handle multiple response shapes
    const items: T[] = Array.isArray(json)
      ? json
      : Array.isArray(json.data)
        ? json.data
        : Array.isArray(json.list)
          ? json.list
          : Array.isArray(json.results)
            ? json.results
            : []

    allItems.push(...items)

    // Check pagination signals
    if (json.has_more === true && json.next_cursor) {
      cursor = json.next_cursor
    } else if (items.length === limit) {
      // Offset-based fallback
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
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const apiKey = Deno.env.get('ONLYFANS_API_KEY')

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'ONLYFANS_API_KEY is not configured. Add it in backend secrets.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // ── Auth: verify the calling user ──
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized — missing Bearer token' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabaseAuth = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: claimsData, error: claimsError } = await supabaseAuth.auth.getClaims(
    authHeader.replace('Bearer ', '')
  )
  if (claimsError || !claimsData?.claims) {
    return new Response(JSON.stringify({ error: 'Unauthorized — invalid token' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // ── Service-role client for DB writes ──
  const db = createClient(supabaseUrl, serviceKey)
  const now = new Date().toISOString()

  // Create a top-level sync log
  const { data: masterLog } = await db.from('sync_logs').insert({
    status: 'running',
    message: 'Starting full sync…',
    records_processed: 0,
  }).select().single()

  try {
    const body = await req.json().catch(() => ({}))
    const filterAccountId = body.account_id as string | undefined

    // ═══════════════════════════════════════════
    // STEP 1 — Fetch all accounts from OnlyFans API
    // ═══════════════════════════════════════════
    let apiAccounts: any[]
    try {
      apiAccounts = await apiFetch<any>('/accounts', apiKey)
    } catch (err: any) {
      // Log the exact error and abort
      await db.from('sync_logs').update({
        status: 'error',
        message: `Failed to fetch /accounts: ${err.message}`,
        details: { endpoint: '/accounts', error: err.message, stack: err.stack },
        completed_at: new Date().toISOString(),
      }).eq('id', masterLog?.id)

      return new Response(JSON.stringify({ error: err.message }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!apiAccounts.length) {
      await db.from('sync_logs').update({
        status: 'success',
        message: 'No accounts returned from API',
        completed_at: new Date().toISOString(),
      }).eq('id', masterLog?.id)

      return new Response(JSON.stringify({ results: [], message: 'No accounts found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Upsert each account into DB
    for (const acc of apiAccounts) {
      const externalId = String(acc.id ?? acc.account_id ?? acc.userId)
      await db.from('accounts').upsert({
        onlyfans_account_id: externalId,
        username: acc.username ?? acc.name ?? null,
        display_name: acc.name ?? acc.username ?? externalId,
        is_active: true,
        last_synced_at: now,
      }, { onConflict: 'onlyfans_account_id' })
    }

    // Retrieve DB accounts to process
    let accountsQuery = db.from('accounts').select('*').eq('is_active', true)
    if (filterAccountId) {
      accountsQuery = accountsQuery.eq('id', filterAccountId)
    }
    const { data: dbAccounts, error: accErr } = await accountsQuery
    if (accErr) throw accErr

    const results: any[] = []
    let totalRecords = 0

    // ═══════════════════════════════════════════
    // STEP 2 — For each account, fetch tracking links
    // ═══════════════════════════════════════════
    for (const account of dbAccounts ?? []) {
      const { data: accountLog } = await db.from('sync_logs').insert({
        account_id: account.id,
        status: 'running',
        message: `Syncing: ${account.display_name}`,
        records_processed: 0,
      }).select().single()

      try {
        const trackingLinks = await apiFetch<any>(
          '/tracking-links',
          apiKey,
          { account_id: account.onlyfans_account_id }
        )

        // Ensure campaigns exist
        const { data: existingCampaigns } = await db
          .from('campaigns').select('*').eq('account_id', account.id)
        const campaignMap = new Map(
          (existingCampaigns ?? []).map((c: any) => [c.name, c.id])
        )

        let linkCount = 0

        for (const link of trackingLinks) {
          const campaignName = link.campaign_name ?? link.campaign ?? link.name ?? 'Unknown Campaign'
          const trafficSource = link.traffic_source ?? link.source ?? null
          const country = link.country ?? link.geo ?? null
          let campaignId = campaignMap.get(campaignName)

          // Auto-create campaign if new
          if (!campaignId) {
            const { data: newCampaign } = await db.from('campaigns').insert({
              account_id: account.id,
              name: campaignName,
              traffic_source: trafficSource,
              country: country,
            }).select().single()
            campaignId = newCampaign?.id
            if (campaignId) campaignMap.set(campaignName, campaignId)
          }
          if (!campaignId) continue

          const clicks = Number(link.clicks ?? 0)
          const subscribers = Number(link.subscribers ?? 0)
          const spenders = Number(link.spenders ?? 0)
          const revenue = Number(link.revenue ?? 0)
          const epc = clicks > 0 ? revenue / clicks : 0
          const rps = subscribers > 0 ? revenue / subscribers : 0
          const convRate = clicks > 0 ? (subscribers / clicks) * 100 : 0
          const externalLinkId = String(link.id ?? link.link_id ?? link.trackingId ?? '')

          await db.from('tracking_links').upsert({
            external_tracking_link_id: externalLinkId || null,
            url: link.url ?? link.link ?? `https://onlyfans.com/${account.onlyfans_account_id}`,
            campaign_id: campaignId,
            account_id: account.id,
            clicks,
            subscribers,
            spenders,
            revenue,
            revenue_per_click: epc,
            revenue_per_subscriber: rps,
            conversion_rate: convRate,
            calculated_at: now,
          }, {
            onConflict: externalLinkId ? 'external_tracking_link_id' : 'url,campaign_id',
          })

          // Also write a daily_metrics row for today
          const today = now.split('T')[0]

          // Find the DB tracking link id
          const { data: dbLink } = await db.from('tracking_links')
            .select('id')
            .eq(externalLinkId ? 'external_tracking_link_id' : 'url',
                externalLinkId || link.url ?? link.link)
            .maybeSingle()

          if (dbLink) {
            await db.from('daily_metrics').upsert({
              tracking_link_id: dbLink.id,
              date: today,
              clicks,
              subscribers,
              spenders,
              revenue,
            }, { onConflict: 'tracking_link_id,date' })
          }

          linkCount++
        }

        // ═══════════════════════════════════════════
        // STEP 3 — Fetch transactions for revenue data
        // ═══════════════════════════════════════════
        let txCount = 0
        try {
          const transactions = await apiFetch<any>(
            '/transactions',
            apiKey,
            { account_id: account.onlyfans_account_id }
          )
          txCount = transactions.length

          // Group revenue by date and update daily_metrics
          const dailyRevenue = new Map<string, number>()
          for (const tx of transactions) {
            const txDate = (tx.date ?? tx.created_at ?? now).split('T')[0]
            const amount = Number(tx.amount ?? tx.revenue ?? 0)
            dailyRevenue.set(txDate, (dailyRevenue.get(txDate) ?? 0) + amount)
          }
          // Revenue from transactions is additive context — tracked in sync log details
        } catch (txErr: any) {
          // Log transaction fetch failure but don't fail the whole account sync
          await db.from('sync_logs').insert({
            account_id: account.id,
            status: 'error',
            message: `Failed /transactions for ${account.display_name}: ${txErr.message}`,
            details: { endpoint: '/transactions', error: txErr.message },
            completed_at: new Date().toISOString(),
            records_processed: 0,
          })
        }

        // Update account's last_synced_at
        await db.from('accounts').update({ last_synced_at: now }).eq('id', account.id)

        totalRecords += linkCount + txCount

        // ── Mark account sync as success ──
        await db.from('sync_logs').update({
          status: 'success',
          message: `Synced ${linkCount} tracking links, ${txCount} transactions`,
          completed_at: new Date().toISOString(),
          records_processed: linkCount + txCount,
          details: {
            links_fetched: trackingLinks.length,
            links_upserted: linkCount,
            transactions_fetched: txCount,
          },
        }).eq('id', accountLog?.id)

        results.push({
          account: account.display_name,
          account_id: account.id,
          status: 'success',
          links: linkCount,
          transactions: txCount,
        })
      } catch (err: any) {
        // ── Mark account sync as error with full details ──
        await db.from('sync_logs').update({
          status: 'error',
          message: `Sync failed for ${account.display_name}: ${err.message}`,
          details: {
            endpoint: 'tracking-links',
            error: err.message,
            stack: err.stack,
            response_status: err.status ?? null,
          },
          completed_at: new Date().toISOString(),
          records_processed: 0,
        }).eq('id', accountLog?.id)

        results.push({
          account: account.display_name,
          account_id: account.id,
          status: 'error',
          error: err.message,
        })
      }
    }

    // ── Update master sync log ──
    await db.from('sync_logs').update({
      status: results.every(r => r.status === 'success') ? 'success' : 'partial',
      message: `Processed ${dbAccounts?.length ?? 0} accounts, ${totalRecords} total records`,
      completed_at: new Date().toISOString(),
      records_processed: totalRecords,
      details: { accounts_processed: dbAccounts?.length, results },
    }).eq('id', masterLog?.id)

    return new Response(JSON.stringify({ results, total_records: totalRecords }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    await db.from('sync_logs').update({
      status: 'error',
      message: `Fatal sync error: ${error.message}`,
      details: { error: error.message, stack: error.stack },
      completed_at: new Date().toISOString(),
    }).eq('id', masterLog?.id)

    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
