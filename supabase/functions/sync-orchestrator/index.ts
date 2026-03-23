import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const API_BASE = 'https://app.onlyfansapi.com/api'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const apiKey = Deno.env.get('ONLYFANS_API_KEY')
  const db = createClient(supabaseUrl, serviceKey)

  try {
    // Mark stuck syncs (running > 3 min) as failed
    const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000).toISOString()
    const { data: stuck } = await db.from('sync_logs')
      .select('id')
      .eq('status', 'running')
      .lt('started_at', threeMinutesAgo)

    if (stuck && stuck.length > 0) {
      const now = new Date().toISOString()
      for (const row of stuck) {
        await db.from('sync_logs').update({
          status: 'error', success: false,
          finished_at: now, completed_at: now,
          error_message: 'Sync timed out — exceeded 3 minute limit',
          message: 'Sync timed out — exceeded 3 minute limit',
        }).eq('id', row.id)
      }
      console.log(`Marked ${stuck.length} stuck syncs as failed`)
    }

    // Step 1: Sync accounts from OF API (fast — ~2s)
    let accountsSynced = 0
    if (apiKey) {
      try {
        const res = await fetch(`${API_BASE}/accounts`, {
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        })
        if (res.ok) {
          const raw = await res.json()
          const apiAccounts: any[] = Array.isArray(raw) ? raw : (raw.data ?? [])
          const now = new Date().toISOString()

          for (const acc of apiAccounts) {
            const ud = acc.onlyfans_user_data ?? {}
            await db.from('accounts').upsert({
              onlyfans_account_id: String(acc.id),
              username: acc.onlyfans_username ?? ud.username ?? null,
              display_name: acc.display_name ?? ud.name ?? acc.onlyfans_username ?? String(acc.id),
              is_active: true,
              last_synced_at: now,
              subscribers_count: ud.subscribersCount ?? 0,
              performer_top: ud.performerTop ?? null,
              subscribe_price: ud.subscribePrice ?? 0,
              last_seen: ud.lastSeen ?? null,
              avatar_url: ud.avatar ?? acc.avatar ?? null,
              avatar_thumb_url: ud.avatarThumbs?.c144 ?? ud.avatarThumbs?.c50 ?? null,
              header_url: ud.header ?? acc.header ?? null,
            }, { onConflict: 'onlyfans_account_id' })
          }
          accountsSynced = apiAccounts.length
          console.log(`Synced ${accountsSynced} accounts with avatars`)
        } else {
          console.error(`API accounts fetch failed: ${res.status}`)
        }
      } catch (err: any) {
        console.error(`API account fetch error: ${err.message}`)
      }
    }

    // Step 2: Get accounts from DB and return them for frontend to dispatch sync-tracking calls
    const { data: accounts, error: accErr } = await db.from('accounts')
      .select('id, display_name, onlyfans_account_id')
      .eq('is_active', true)

    if (accErr) throw accErr

    return new Response(JSON.stringify({
      message: `Synced ${accountsSynced} accounts`,
      accounts_synced: accountsSynced,
      accounts: (accounts ?? []).map(a => ({
        id: a.id,
        display_name: a.display_name,
        onlyfans_account_id: a.onlyfans_account_id,
      })),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    console.error(`Orchestrator error: ${error.message}`)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
