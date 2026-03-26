const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const API_BASE = 'https://app.onlyfansapi.com/api'
const ACCT_ID = 'acct_50601363a87541b0910ffd6c1181314c'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const apiKey = Deno.env.get('ONLYFANS_API_KEY')
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'ONLYFANS_API_KEY not set' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const reqHeaders: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  }

  // Check for deep-dive request
  let body: any = null
  if (req.method === 'POST') {
    try { body = await req.json() } catch { body = null }
  }

  if (body?.action === 'advanced_endpoint') {
    const { url } = body
    if (!url) {
      return new Response(JSON.stringify({ error: 'Missing url' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    try {
      const res = await fetch(url, { headers: reqHeaders })
      const bodyText = await res.text()
      let bodyParsed: any = null
      try { bodyParsed = JSON.parse(bodyText) } catch { bodyParsed = bodyText }
      const responseHeaders: Record<string, string> = {}
      res.headers.forEach((v, k) => { responseHeaders[k] = v })
      return new Response(JSON.stringify({
        url,
        status: res.status,
        status_text: res.statusText,
        headers: responseHeaders,
        body: bodyParsed,
      }, null, 2), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    } catch (err: any) {
      return new Response(JSON.stringify({ url, error: err.message }, null, 2), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
  }

  if (body?.action === 'tracking_link_deep_dive') {
    const { account_id, tracking_link_id, endpoint } = body
    if (!account_id || !tracking_link_id || !endpoint) {
      return new Response(JSON.stringify({ error: 'Missing account_id, tracking_link_id, or endpoint' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const url = `${API_BASE}/${account_id}/tracking-links/${tracking_link_id}/${endpoint}`
    try {
      const res = await fetch(url, { headers: reqHeaders })
      const bodyText = await res.text()
      let bodyParsed: any = null
      try { bodyParsed = JSON.parse(bodyText) } catch { bodyParsed = bodyText }

      const responseHeaders: Record<string, string> = {}
      res.headers.forEach((v, k) => { responseHeaders[k] = v })

      return new Response(JSON.stringify({
        url,
        status: res.status,
        status_text: res.statusText,
        headers: responseHeaders,
        body: bodyParsed,
      }, null, 2), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    } catch (err: any) {
      return new Response(JSON.stringify({ url, error: err.message }, null, 2), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
  }

  // Default: test all 3 standard endpoints
  const endpoints = [
    { name: 'accounts', url: `${API_BASE}/accounts` },
    { name: 'tracking-links', url: `${API_BASE}/${ACCT_ID}/tracking-links` },
    { name: 'transactions', url: `${API_BASE}/${ACCT_ID}/transactions` },
  ]

  const results: Record<string, any> = {}

  for (const ep of endpoints) {
    try {
      const res = await fetch(ep.url, { headers: reqHeaders })
      const bodyText = await res.text()
      let bodyParsed: any = null
      try { bodyParsed = JSON.parse(bodyText) } catch { bodyParsed = bodyText }

      const responseHeaders: Record<string, string> = {}
      res.headers.forEach((v, k) => { responseHeaders[k] = v })

      results[ep.name] = {
        url: ep.url,
        status: res.status,
        status_text: res.statusText,
        headers: responseHeaders,
        body: bodyParsed,
      }
    } catch (err: any) {
      results[ep.name] = {
        url: ep.url,
        error: err.message,
      }
    }
  }

  return new Response(JSON.stringify(results, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
