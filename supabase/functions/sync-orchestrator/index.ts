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
          status: 'error',
          success: false,
          finished_at: now,
          completed_at: now,
          error_message: 'Sync timed out — exceeded 3 minute limit',
          message: 'Sync timed out — exceeded 3 minute limit',
        }).eq('id', row.id)
      }
      console.log(`Marked ${stuck.length} stuck syncs as failed`)
    }

    // Get active accounts
    const { data: accounts, error: accErr } = await db.from('accounts')
      .select('id, display_name, onlyfans_account_id')
      .eq('is_active', true)

    if (accErr) throw accErr
    if (!accounts || accounts.length === 0) {
      return new Response(JSON.stringify({ message: 'No active accounts', dispatched: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Dispatch one sync-account call per account (fire-and-forget)
    const dispatched: string[] = []
    for (const account of accounts) {
      // Fire and forget — don't await
      fetch(`${supabaseUrl}/functions/v1/sync-account`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          account_id: account.id,
          onlyfans_account_id: account.onlyfans_account_id,
          display_name: account.display_name,
        }),
      }).catch(err => console.error(`Failed to dispatch sync for ${account.display_name}: ${err.message}`))

      dispatched.push(account.display_name)
      console.log(`Dispatched sync for ${account.display_name}`)
    }

    return new Response(JSON.stringify({
      message: `Dispatched sync for ${dispatched.length} accounts`,
      dispatched,
      accounts: accounts.map(a => ({ id: a.id, display_name: a.display_name })),
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
