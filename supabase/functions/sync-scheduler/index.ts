import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const db = createClient(supabaseUrl, serviceKey)

  try {
    // Check last successful full sync
    const { data: lastSync } = await db.from('sync_logs')
      .select('completed_at')
      .eq('status', 'success')
      .is('account_id', null) // orchestrator logs have no account_id
      .order('completed_at', { ascending: false })
      .limit(1)
      .single()

    const lastSyncTime = lastSync?.completed_at ? new Date(lastSync.completed_at).getTime() : 0
    const hoursSinceSync = (Date.now() - lastSyncTime) / (1000 * 60 * 60)

    console.log(`Last full sync: ${hoursSinceSync.toFixed(1)} hours ago`)

    if (hoursSinceSync >= 24 || lastSyncTime === 0) {
      console.log('Triggering sync-orchestrator (auto)')

      const res = await fetch(`${supabaseUrl}/functions/v1/sync-orchestrator`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${anonKey}`,
        },
        body: JSON.stringify({ triggered_by: 'auto' }),
      })

      const result = await res.json()
      console.log('Orchestrator result:', JSON.stringify(result))

      return new Response(JSON.stringify({
        action: 'sync_triggered',
        hours_since_last: Math.round(hoursSinceSync),
        result,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({
      action: 'skipped',
      hours_since_last: Math.round(hoursSinceSync),
      message: `Last sync was ${Math.round(hoursSinceSync)}h ago — next sync after 24h`,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    console.error(`Scheduler error: ${error.message}`)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
