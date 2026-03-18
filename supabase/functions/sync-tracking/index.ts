import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const onlyfansApiSecret = Deno.env.get('ONLYFANS_API_SECRET')

    if (!onlyfansApiSecret) {
      throw new Error('ONLYFANS_API_SECRET not configured')
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabaseAuth = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    })
    const { data: claimsData, error: claimsError } = await supabaseAuth.auth.getClaims(
      authHeader.replace('Bearer ', '')
    )
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(supabaseUrl, supabaseKey)
    const body = await req.json().catch(() => ({}))
    const accountId = body.account_id

    // Get accounts to sync
    let accountsQuery = supabase.from('accounts').select('*').eq('is_active', true)
    if (accountId) {
      accountsQuery = accountsQuery.eq('id', accountId)
    }
    const { data: accounts, error: accountsError } = await accountsQuery
    if (accountsError) throw accountsError

    const results = []

    for (const account of accounts || []) {
      // Create sync log
      const { data: syncLog } = await supabase.from('sync_logs').insert({
        account_id: account.id,
        status: 'running',
        message: `Syncing account: ${account.display_name}`
      }).select().single()

      try {
        // Fetch tracking links from OnlyFans API
        const apiResponse = await fetch(
          `https://api.onlyfans.com/tracking/links?account_id=${account.onlyfans_account_id}`,
          {
            headers: {
              'Authorization': `Bearer ${onlyfansApiSecret}`,
              'Content-Type': 'application/json',
            }
          }
        )

        if (!apiResponse.ok) {
          throw new Error(`API returned ${apiResponse.status}: ${await apiResponse.text()}`)
        }

        const apiData = await apiResponse.json()

        // Get campaigns for this account
        const { data: campaigns } = await supabase
          .from('campaigns')
          .select('*')
          .eq('account_id', account.id)

        const campaignMap = new Map((campaigns || []).map(c => [c.name, c.id]))

        // Process each tracking link from the API
        for (const link of apiData.links || []) {
          let campaignId = campaignMap.get(link.campaign_name)

          if (!campaignId) {
            const { data: newCampaign } = await supabase.from('campaigns').insert({
              account_id: account.id,
              name: link.campaign_name || 'Unknown Campaign',
              traffic_source: link.traffic_source || null,
              country: link.country || null,
            }).select().single()
            campaignId = newCampaign?.id
            if (campaignId) campaignMap.set(link.campaign_name, campaignId)
          }

          const revenuePerClick = link.clicks > 0 ? link.revenue / link.clicks : 0
          const revenuePerSub = link.subscribers > 0 ? link.revenue / link.subscribers : 0

          // Upsert tracking link
          await supabase.from('tracking_links').upsert({
            url: link.url,
            campaign_id: campaignId,
            account_id: account.id,
            clicks: link.clicks || 0,
            subscribers: link.subscribers || 0,
            spenders: link.spenders || 0,
            revenue: link.revenue || 0,
            revenue_per_click: revenuePerClick,
            revenue_per_subscriber: revenuePerSub,
            calculated_at: new Date().toISOString(),
          }, { onConflict: 'id' })

          // Insert daily metric
          const today = new Date().toISOString().split('T')[0]
          await supabase.from('daily_metrics').upsert({
            tracking_link_id: link.tracking_link_id,
            date: today,
            clicks: link.clicks || 0,
            subscribers: link.subscribers || 0,
            spenders: link.spenders || 0,
            revenue: link.revenue || 0,
          }, { onConflict: 'tracking_link_id,date' })
        }

        // Update sync log
        await supabase.from('sync_logs').update({
          status: 'success',
          message: `Synced ${(apiData.links || []).length} links`,
          completed_at: new Date().toISOString(),
        }).eq('id', syncLog?.id)

        results.push({ account: account.display_name, status: 'success', links: (apiData.links || []).length })
      } catch (err) {
        await supabase.from('sync_logs').update({
          status: 'error',
          message: err.message,
          details: { stack: err.stack },
          completed_at: new Date().toISOString(),
        }).eq('id', syncLog?.id)

        results.push({ account: account.display_name, status: 'error', error: err.message })
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
