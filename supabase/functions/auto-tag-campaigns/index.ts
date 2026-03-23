import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const DEFAULT_RULES = [
  { tag_name: 'Reddit', keywords: ['reddit', 'redd'], color: '#ff4500', priority: 1 },
  { tag_name: 'Instagram', keywords: ['instagram', 'insta', 'ig'], color: '#e1306c', priority: 2 },
  { tag_name: 'Twitter', keywords: ['twitter', 'twit', 'tw'], color: '#1da1f2', priority: 3 },
  { tag_name: 'OnlyFinder', keywords: ['onlyfinder', 'finder', 'findeross', 'onlyfind'], color: '#0891b2', priority: 4 },
  { tag_name: 'SEO', keywords: ['seo', 'search', 'google', 'earch.co', 'onlysearch'], color: '#16a34a', priority: 5 },
  { tag_name: 'Blog', keywords: ['blog'], color: '#7c3aed', priority: 6 },
  { tag_name: 'Bluesky', keywords: ['bluesky', 'blue sky', 'bsky'], color: '#0085ff', priority: 7 },
  { tag_name: 'TikTok', keywords: ['tiktok', 'tik tok'], color: '#010101', priority: 8 },
  { tag_name: 'Telegram', keywords: ['telegram', 'tg group', 'tg'], color: '#2aabee', priority: 9 },
  { tag_name: 'OnlyTraffic', keywords: ['onlytraffic', 'only traffic'], color: '#f59e0b', priority: 10 },
  { tag_name: 'Juicy', keywords: ['juicy'], color: '#ec4899', priority: 11 },
  { tag_name: 'Affiliate', keywords: ['affiliate', 'aff'], color: '#8b5cf6', priority: 12 },
  { tag_name: 'SFS', keywords: ['sfs'], color: '#64748b', priority: 13 },
  { tag_name: 'Creator Traffic', keywords: ['creator traffic', '1.ads'], color: '#f97316', priority: 14 },
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const db = createClient(supabaseUrl, serviceKey)

  try {
    // Seed default rules if table is empty
    const { data: existingRules } = await db.from('source_tag_rules').select('id').limit(1)
    if (!existingRules || existingRules.length === 0) {
      await db.from('source_tag_rules').insert(DEFAULT_RULES)
      console.log('Seeded default source tag rules')
    }

    // Fetch all rules ordered by priority
    const { data: rules } = await db
      .from('source_tag_rules')
      .select('*')
      .order('priority', { ascending: true })

    if (!rules || rules.length === 0) {
      return new Response(JSON.stringify({ tagged: 0, skipped: 0, untagged: 0, message: 'No rules configured' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Fetch untagged tracking links (not manually tagged) — paginate through all
    let allLinks: any[] = []
    let from = 0
    const batchSize = 1000
    while (true) {
      const { data: batch } = await db
        .from('tracking_links')
        .select('id, campaign_name, source_tag, manually_tagged')
        .eq('manually_tagged', false)
        .or('source_tag.is.null,source_tag.eq.Untagged,source_tag.eq.')
        .range(from, from + batchSize - 1)
      if (!batch || batch.length === 0) break
      allLinks = allLinks.concat(batch)
      if (batch.length < batchSize) break
      from += batchSize
    }

    console.log(`Processing ${allLinks.length} untagged links against ${rules.length} rules`)

    // Match in memory, then batch update per tag
    const tagMap: Record<string, string[]> = {} // tag_name -> [link_ids]
    let untagged = 0

    for (const link of allLinks) {
      const name = (link.campaign_name || '').toLowerCase()
      let matched = false

      for (const rule of rules) {
        const keywords: string[] = rule.keywords || []
        for (const kw of keywords) {
          if (name.includes(kw.toLowerCase())) {
            if (!tagMap[rule.tag_name]) tagMap[rule.tag_name] = []
            tagMap[rule.tag_name].push(link.id)
            matched = true
            break
          }
        }
        if (matched) break
      }

      if (!matched) untagged++
    }

    // Batch update per tag name
    let tagged = 0
    for (const [tagName, ids] of Object.entries(tagMap)) {
      // Update in chunks of 200 to avoid query size limits
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200)
        await db.from('tracking_links')
          .update({ source_tag: tagName })
          .in('id', chunk)
      }
      tagged += ids.length
    }

    const { count: skipped } = await db.from('tracking_links')
      .select('id', { count: 'exact', head: true })
      .eq('manually_tagged', true)

    console.log(`Auto-tag complete: tagged=${tagged}, skipped=${skipped || 0}, untagged=${untagged}`)

    return new Response(JSON.stringify({ tagged, skipped: skipped || 0, untagged }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    console.error('Auto-tag error:', error.message)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
