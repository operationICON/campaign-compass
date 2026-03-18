import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const API_BASE = 'https://api.onlyfans.com'

interface PaginatedResponse<T> {
  data: T[]
  has_more?: boolean
  next_cursor?: string
  total?: number
}

async function apiFetch<T>(
  path: string,
  apiKey: string,
  params: Record<string, string> = {}
): Promise<T[]> {
  const allItems: T[] = []
  let cursor: string | undefined

  while (true) {
    const url = new URL(`${API_BASE}${path}`)
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v)
    }
    if (cursor) {
      url.searchParams.set('cursor', cursor)
    }

    const res = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`API ${path} returned ${res.status}: ${text}`)
    }

    const json = await res.json() as PaginatedResponse<T>
    const items = json.data ?? (Array.isArray(json) ? json : [])
    allItems.push(...items)

    if (json.has_more && json.next_cursor) {
      cursor = json.next_cursor
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
    return new Response(JSON.stringify({ error: 'ONLYFANS_API_KEY not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Authenticate caller
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabaseAuth = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: claimsData, error: claimsError } = await supabaseAuth.auth.getClaims(
    authHeader.replace('Bearer ', '')
  )
  if (claimsError || !claimsData?.claims) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  try {
    const body = await req.json().catch(() => ({}))
    const filterAccountId = body.account_id as string | undefined

    // ----- Step 1: Fetch & sync accounts from API -----
    let apiAccounts: any[] = []
    try {
      apiAccounts = await apiFetch<any>('/accounts', apiKey)
    } catch (err) {
      await logError(supabase, null, 'fetch_accounts', err)
      // If we can't fetch accounts from API, fall back to DB accounts
    }

    // Upsert accounts from API into DB
    for (const acc of apiAccounts) {
      await supabase.from('accounts').upsert({
        onlyfans_account_id: String(acc.id ?? acc.account_id),
        display_name: acc.username ?? acc.name ?? String(acc.id),
        is_active: true,
      }, { onConflict: 'onlyfans_account_id' })
    }

    // Get DB accounts to sync
    let accountsQuery = supabase.from('accounts').select('*').eq('is_active', true)
    if (filterAccountId) {
      accountsQuery = accountsQuery.eq('id', filterAccountId)
    }
    const { data: accounts, error: accErr } = await accountsQuery
    if (accErr) throw accErr

    const results: any[] = []

    for (const account of accounts ?? []) {
      const { data: syncLog } = await supabase.from('sync_logs').insert({
        account_id: account.id,
        status: 'running',
        message: `Syncing account: ${account.display_name}`,
      }).select().single()

      try {
        // ----- Step 2: Fetch tracking links -----
        const trackingLinks = await apiFetch<any>(
          '/tracking-links',
          apiKey,
          { account_id: account.onlyfans_account_id }
        )

        // Build campaign map
        const { data: existingCampaigns } = await supabase
          .from('campaigns').select('*').eq('account_id', account.id)
        const campaignMap = new Map(
          (existingCampaigns ?? []).map((c: any) => [c.name, c.id])
        )

        const linkIdMap = new Map<string, string>() // api link id -> db link id

        for (const link of trackingLinks) {
          const campaignName = link.campaign_name ?? link.campaign ?? 'Unknown Campaign'
          let campaignId = campaignMap.get(campaignName)

          if (!campaignId) {
            const { data: newCampaign } = await supabase.from('campaigns').insert({
              account_id: account.id,
              name: campaignName,
              traffic_source: link.traffic_source ?? null,
              country: link.country ?? null,
            }).select().single()
            campaignId = newCampaign?.id
            if (campaignId) campaignMap.set(campaignName, campaignId)
          }

          if (!campaignId) continue

          const clicks = Number(link.clicks ?? 0)
          const subscribers = Number(link.subscribers ?? 0)
          const spenders = Number(link.spenders ?? 0)
          const revenue = Number(link.revenue ?? 0)

          const { data: upserted } = await supabase.from('tracking_links').upsert({
            url: link.url ?? link.link ?? `https://onlyfans.com/${account.onlyfans_account_id}`,
            campaign_id: campaignId,
            account_id: account.id,
            clicks,
            subscribers,
            spenders,
            revenue,
            revenue_per_click: clicks > 0 ? revenue / clicks : 0,
            revenue_per_subscriber: subscribers > 0 ? revenue / subscribers : 0,
            calculated_at: new Date().toISOString(),
          }, { onConflict: 'url,campaign_id' }).select().single()

          if (upserted) {
            const apiLinkId = String(link.id ?? link.link_id ?? link.url)
            linkIdMap.set(apiLinkId, upserted.id)
          }
        }

        // ----- Step 3: Fetch transactions -----
        let transactions: any[] = []
        try {
          transactions = await apiFetch<any>(
            '/transactions',
            apiKey,
            { account_id: account.onlyfans_account_id }
          )
        } catch (err) {
          await logError(supabase, account.id, 'fetch_transactions', err)
        }

        // ----- Step 4: Normalize into daily_metrics -----
        // Group transactions by tracking_link_id + date
        const metricsMap = new Map<string, {
          tracking_link_id: string
          date: string
          clicks: number
          subscribers: number
          spenders: number
          revenue: number
        }>()

        for (const tx of transactions) {
          const txDate = (tx.date ?? tx.created_at ?? new Date().toISOString()).split('T')[0]
          const apiLinkId = String(tx.tracking_link_id ?? tx.link_id ?? '')
          const dbLinkId = linkIdMap.get(apiLinkId)
          if (!dbLinkId) continue

          const key = `${dbLinkId}:${txDate}`
          const existing = metricsMap.get(key) ?? {
            tracking_link_id: dbLinkId,
            date: txDate,
            clicks: 0,
            subscribers: 0,
            spenders: 0,
            revenue: 0,
          }

          existing.revenue += Number(tx.amount ?? tx.revenue ?? 0)
          if (tx.type === 'subscription' || tx.is_subscription) {
            existing.subscribers += 1
          }
          if (Number(tx.amount ?? 0) > 0) {
            existing.spenders += 1
          }
          metricsMap.set(key, existing)
        }

        // Also add today's metrics from tracking link totals if no transactions
        if (transactions.length === 0) {
          const today = new Date().toISOString().split('T')[0]
          for (const link of trackingLinks) {
            const apiLinkId = String(link.id ?? link.link_id ?? link.url)
            const dbLinkId = linkIdMap.get(apiLinkId)
            if (!dbLinkId) continue

            const key = `${dbLinkId}:${today}`
            if (!metricsMap.has(key)) {
              metricsMap.set(key, {
                tracking_link_id: dbLinkId,
                date: today,
                clicks: Number(link.clicks ?? 0),
                subscribers: Number(link.subscribers ?? 0),
                spenders: Number(link.spenders ?? 0),
                revenue: Number(link.revenue ?? 0),
              })
            }
          }
        }

        // Upsert daily metrics
        for (const metric of metricsMap.values()) {
          await supabase.from('daily_metrics').upsert(metric, {
            onConflict: 'tracking_link_id,date',
          })
        }

        // Update sync log as success
        await supabase.from('sync_logs').update({
          status: 'success',
          message: `Synced ${trackingLinks.length} links, ${transactions.length} transactions`,
          completed_at: new Date().toISOString(),
          details: {
            links_count: trackingLinks.length,
            transactions_count: transactions.length,
            metrics_count: metricsMap.size,
          },
        }).eq('id', syncLog?.id)

        results.push({
          account: account.display_name,
          status: 'success',
          links: trackingLinks.length,
          transactions: transactions.length,
        })
      } catch (err: any) {
        await supabase.from('sync_logs').update({
          status: 'error',
          message: err.message,
          details: { stack: err.stack, endpoint: 'sync_all' },
          completed_at: new Date().toISOString(),
        }).eq('id', syncLog?.id)

        results.push({ account: account.display_name, status: 'error', error: err.message })
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

async function logError(supabase: any, accountId: string | null, endpoint: string, err: any) {
  await supabase.from('sync_logs').insert({
    account_id: accountId,
    status: 'error',
    message: `Failed ${endpoint}: ${err.message}`,
    details: { stack: err.stack, endpoint },
    completed_at: new Date().toISOString(),
  })
}
