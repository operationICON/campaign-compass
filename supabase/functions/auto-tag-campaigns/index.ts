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
    const { data: rules, error: rulesErr } = await db
      .from('source_tag_rules')
      .select('*')
      .order('priority', { ascending: true })
    if (rulesErr) throw rulesErr

    // Fetch untagged tracking links (not manually tagged)
    const { data: untaggedLinks, error: linksErr } = await db
      .from('tracking_links')
      .select('id, campaign_name, source_tag, manually_tagged')
      .eq('manually_tagged', false)
      .or('source_tag.is.null,source_tag.eq.Untagged,source_tag.eq.')

    if (linksErr) throw linksErr

    let tagged = 0
    let skipped = 0
    let untagged = 0

    for (const link of untaggedLinks || []) {
      const name = (link.campaign_name || '').toLowerCase()
      let matched = false

      for (const rule of rules || []) {
        const keywords: string[] = rule.keywords || []
        for (const kw of keywords) {
          if (name.includes(kw.toLowerCase())) {
            await db.from('tracking_links').update({ source_tag: rule.tag_name }).eq('id', link.id)
            tagged++
            matched = true
            break
          }
        }
        if (matched) break
      }

      if (!matched) {
        untagged++
      }
    }

    skipped = (await db.from('tracking_links').select('id', { count: 'exact', head: true }).eq('manually_tagged', true)).count || 0

    console.log(`Auto-tag complete: tagged=${tagged}, skipped=${skipped}, untagged=${untagged}`)

    return new Response(JSON.stringify({ tagged, skipped, untagged }), {
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
