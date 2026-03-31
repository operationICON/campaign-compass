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

  let body: any = {}
  try { body = await req.json() } catch {}
  const triggeredBy = body.triggered_by ?? 'manual'

  try {
    // Mark stuck syncs (running > 8 min) as failed — increased from 3 min for large accounts
    const threeMinutesAgo = new Date(Date.now() - 8 * 60 * 1000).toISOString()
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

    // Create orchestrator sync log
    const startedAt = new Date().toISOString()
    const { data: orchLog } = await db.from('sync_logs').insert({
      started_at: startedAt,
      status: 'running',
      success: false,
      message: 'Orchestrator started — syncing accounts sequentially',
      records_processed: 0,
      triggered_by: triggeredBy,
      accounts_synced: 0,
      tracking_links_synced: 0,
    }).select().single()

    const orchLogId = orchLog?.id

    // Get all active accounts
    const { data: accounts, error: accErr } = await db.from('accounts')
      .select('id, display_name, onlyfans_account_id, sync_enabled, username')
      .eq('is_active', true)

    if (accErr) throw accErr

    const accountList = accounts ?? []
    let accountsSynced = 0
    let totalLinksSynced = 0
    const errors: string[] = []

    // Call sync-account sequentially for each account
    for (const account of accountList) {
      // Check sync_enabled flag
      if (account.sync_enabled === false) {
        console.log(`Skipped ${account.display_name} (@${account.username}) — sync disabled in settings`)
        // Log skipped account
        await db.from('sync_logs').insert({
          account_id: account.id,
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          status: 'skipped',
          success: true,
          message: `Skipped ${account.display_name} — sync disabled in settings`,
          records_processed: 0,
          triggered_by: triggeredBy,
        })
        continue
      }

      try {
        console.log(`Syncing account: ${account.display_name}`)
        const res = await fetch(`${supabaseUrl}/functions/v1/sync-account`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${anonKey}`,
          },
          body: JSON.stringify({
            account_id: account.id,
            onlyfans_account_id: account.onlyfans_account_id,
            display_name: account.display_name,
          }),
        })

        if (res.ok) {
          const result = await res.json()
          accountsSynced++
          totalLinksSynced += (result.links ?? 0)
          console.log(`✓ ${account.display_name}: ${result.links} links, ${result.transactions} tx`)
        } else {
          const errText = await res.text()
          console.error(`✗ ${account.display_name}: ${res.status} ${errText}`)
          errors.push(`${account.display_name}: ${errText}`)
        }
      } catch (err: any) {
        console.error(`✗ ${account.display_name} call failed: ${err.message}`)
        errors.push(`${account.display_name}: ${err.message}`)
        // Continue to next account
      }
    }

    // Auto-tag removed — source tags are manual only

    // Update orchestrator log
    const now = new Date().toISOString()
    const hasErrors = errors.length > 0
    if (orchLogId) {
      await db.from('sync_logs').update({
        status: hasErrors ? 'partial' : 'success',
        success: !hasErrors,
        finished_at: now,
        completed_at: now,
        accounts_synced: accountsSynced,
        tracking_links_synced: totalLinksSynced,
        records_processed: totalLinksSynced,
        message: `Synced ${accountsSynced}/${accountList.length} accounts, ${totalLinksSynced} links${hasErrors ? ` (${errors.length} errors)` : ''}`,
        error_message: hasErrors ? errors.join('; ') : null,
      }).eq('id', orchLogId)
    }

    return new Response(JSON.stringify({
      message: `Synced ${accountsSynced}/${accountList.length} accounts`,
      accounts_synced: accountsSynced,
      tracking_links_synced: totalLinksSynced,
      errors: errors.length > 0 ? errors : undefined,
      accounts: accountList.map(a => ({
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
