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
  const airtableKey = Deno.env.get('AIRTABLE_API_KEY')
  const airtableBaseId = Deno.env.get('AIRTABLE_BASE_ID')
  const airtableTableName = Deno.env.get('AIRTABLE_TABLE_NAME') || 'Expenses'

  if (!airtableKey || !airtableBaseId) {
    return new Response(JSON.stringify({ error: 'AIRTABLE_API_KEY and AIRTABLE_BASE_ID not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  const db = createClient(supabaseUrl, serviceKey)

  try {
    // 1. Fetch records from AirTable with pagination
    const allRecords: any[] = []
    let offset: string | undefined = undefined

    do {
      const url = new URL(`https://api.airtable.com/v0/${airtableBaseId}/${encodeURIComponent(airtableTableName)}`)
      url.searchParams.set('pageSize', '100')
      if (offset) url.searchParams.set('offset', offset)

      const res = await fetch(url.toString(), {
        headers: { 'Authorization': `Bearer ${airtableKey}` },
      })

      if (!res.ok) {
        const errText = await res.text()
        throw new Error(`AirTable API ${res.status}: ${errText}`)
      }

      const json = await res.json()
      allRecords.push(...(json.records || []))
      offset = json.offset
    } while (offset)

    console.log(`[AirTable] Fetched ${allRecords.length} expense records`)

    if (allRecords.length === 0) {
      return new Response(JSON.stringify({ status: 'success', message: 'No records in AirTable', synced: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // 2. Fetch existing ad_spend records to check for manual entries
    const airtableIds = allRecords.map(r => r.id)
    const existingMap: Record<string, any> = {}
    for (let i = 0; i < airtableIds.length; i += 200) {
      const batch = airtableIds.slice(i, i + 200)
      const { data: existing } = await db.from('ad_spend')
        .select('airtable_record_id, sync_source, tracking_link_id, manually_tagged')
        .in('airtable_record_id', batch)
      for (const row of existing ?? []) {
        existingMap[row.airtable_record_id] = row
      }
    }

    // 3. Fetch tracking_links for campaign name matching
    const { data: allLinks } = await db.from('tracking_links')
      .select('id, campaign_name, account_id, cost_type, cost_value, cost_total, source_tag, manually_tagged')

    const linkByCampaign: Record<string, any> = {}
    for (const link of allLinks ?? []) {
      if (link.campaign_name) {
        linkByCampaign[link.campaign_name.toLowerCase()] = link
      }
    }

    // 4. Build upsert payloads — respect manual entries
    let synced = 0
    let skippedManual = 0
    const payloads: any[] = []

    for (const record of allRecords) {
      const f = record.fields
      const airtableId = record.id
      const existing = existingMap[airtableId]

      // NEVER overwrite manual dashboard entries
      if (existing?.sync_source === 'manual') {
        skippedManual++
        continue
      }

      const campaignName = f['campaign_name'] || f['Campaign Name'] || f['campaign'] || ''
      const spendType = f['spend_type'] || f['Spend Type'] || f['type'] || 'FIXED'
      const costValue = Number(f['cost_value'] || f['Cost Value'] || f['amount'] || 0)
      const sourceTag = f['source_tag'] || f['Source Tag'] || f['source'] || null
      const notes = f['notes'] || f['Notes'] || null
      const expenseDate = f['expense_date'] || f['Date'] || f['date'] || new Date().toISOString().split('T')[0]

      // Try to match a tracking link by campaign name
      const matchedLink = linkByCampaign[campaignName.toLowerCase()]

      // Preserve tracking_link_id if already matched
      const trackingLinkId = existing?.tracking_link_id || matchedLink?.id || null

      // Find campaign_id and account_id from matched link
      let campaignId = matchedLink?.campaign_id
      let accountId = matchedLink?.account_id

      // If no campaign match, try to find any campaign
      if (!campaignId) {
        const { data: campaign } = await db.from('campaigns')
          .select('id, account_id')
          .ilike('name', campaignName)
          .limit(1)
          .single()
        if (campaign) {
          campaignId = campaign.id
          accountId = campaign.account_id
        }
      }

      if (!campaignId) {
        console.log(`[AirTable] Skipping "${campaignName}" — no matching campaign found`)
        continue
      }

      // Calculate total based on spend type
      let amount = costValue
      if (matchedLink && spendType.toUpperCase() === 'CPC') {
        amount = (matchedLink.clicks || 0) * costValue
      } else if (matchedLink && spendType.toUpperCase() === 'CPL') {
        amount = (matchedLink.subscribers || 0) * costValue
      }

      payloads.push({
        airtable_record_id: airtableId,
        campaign_id: campaignId,
        account_id: accountId || null,
        tracking_link_id: trackingLinkId,
        traffic_source: sourceTag || 'airtable',
        spend_type: spendType.toUpperCase(),
        source_tag: sourceTag,
        amount,
        date: expenseDate,
        notes,
        sync_source: 'airtable',
      })

      // 5. Update tracking_links with COALESCE protection
      if (trackingLinkId && matchedLink) {
        const hasManualCost = matchedLink.cost_type && Number(matchedLink.cost_value || 0) > 0
        const hasManualTag = matchedLink.source_tag && matchedLink.source_tag !== 'Untagged' && matchedLink.manually_tagged

        // Only update tracking_links if no manual cost is already set
        if (!hasManualCost) {
          const clicks = matchedLink.clicks || 0
          const subs = matchedLink.subscribers || 0
          const rev = matchedLink.revenue || 0
          const costType = spendType.toUpperCase()

          let cost_total = 0
          if (costType === 'CPC') cost_total = clicks * costValue
          else if (costType === 'CPL') cost_total = subs * costValue
          else cost_total = costValue

          const profit = rev - cost_total
          const roi = cost_total > 0 ? (profit / cost_total) * 100 : 0
          const cpl_real = subs > 0 ? cost_total / subs : 0
          const cvr = clicks > 0 ? (subs / clicks) * 100 : 0

          let status = 'NO_DATA'
          if (cost_total > 0) {
            if (roi > 150) status = 'SCALE'
            else if (roi >= 50) status = 'WATCH'
            else if (roi >= 0) status = 'LOW'
            else status = 'KILL'
          }

          const updatePayload: Record<string, any> = {
            cost_type: costType,
            cost_value: costValue,
            cost_total, profit, roi, cpl_real, cvr, status,
          }

          // Only update source_tag if not manually tagged
          if (!hasManualTag && sourceTag) {
            updatePayload.source_tag = sourceTag
          }

          await db.from('tracking_links').update(updatePayload).eq('id', trackingLinkId)
        }
      }

      synced++
    }

    // 6. Batch upsert ad_spend records
    for (let i = 0; i < payloads.length; i += 25) {
      const batch = payloads.slice(i, i + 25)
      const { error } = await db.from('ad_spend').upsert(batch, {
        onConflict: 'airtable_record_id',
        ignoreDuplicates: false,
      })
      if (error) {
        console.error(`[AirTable] Upsert batch error:`, error.message)
      }
    }

    // 7. Log result
    await db.from('notifications').insert({
      type: 'sync_success',
      message: `AirTable sync: ${synced} expenses imported, ${skippedManual} manual entries preserved`,
    })

    console.log(`[AirTable] Synced ${synced} records, skipped ${skippedManual} manual entries`)

    return new Response(JSON.stringify({
      status: 'success',
      synced,
      skippedManual,
      total: allRecords.length,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (error: any) {
    console.error(`[AirTable] Error: ${error.message}`)

    await db.from('notifications').insert({
      type: 'sync_failed',
      message: `AirTable sync failed: ${error.message}`,
    })

    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
