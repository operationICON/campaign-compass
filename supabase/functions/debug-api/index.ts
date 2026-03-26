const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const API_BASE = 'https://app.onlyfansapi.com/api'

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

  let body: any = null
  if (req.method === 'POST') {
    try { body = await req.json() } catch { body = null }
  }

  // Return API key for direct browser calls (internal debug tool only)
  if (body?.action === 'get_api_key') {
    return new Response(JSON.stringify({ key: apiKey }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Generic endpoint proxy
  if (body?.action === 'call_endpoint') {
    const { url } = body
    if (!url) {
      return new Response(JSON.stringify({ error: 'Missing url' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const fullUrl = url.startsWith('http') ? url : `${API_BASE}${url.startsWith('/') ? '' : '/'}${url}`

    try {
      const start = Date.now()
      const res = await fetch(fullUrl, { headers: reqHeaders })
      const response_time_ms = Date.now() - start
      const bodyText = await res.text()
      let bodyParsed: any = null
      try { bodyParsed = JSON.parse(bodyText) } catch { bodyParsed = bodyText }

      const responseHeaders: Record<string, string> = {}
      res.headers.forEach((v, k) => { responseHeaders[k] = v })

      return new Response(JSON.stringify({
        url: fullUrl,
        status: res.status,
        status_text: res.statusText,
        response_time_ms,
        headers: responseHeaders,
        body: bodyParsed,
      }, null, 2), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    } catch (err: any) {
      return new Response(JSON.stringify({ url: fullUrl, error: err.message }, null, 2), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
  }

  // Legacy: default test
  const ACCT_ID = 'acct_50601363a87541b0910ffd6c1181314c'
  const endpoints = [
    { name: 'accounts', url: `${API_BASE}/accounts` },
    { name: 'tracking-links', url: `${API_BASE}/${ACCT_ID}/tracking-links` },
    { name: 'transactions', url: `${API_BASE}/${ACCT_ID}/transactions` },
  ]

  const results: Record<string, any> = {}
  for (const ep of endpoints) {
    try {
      const start = Date.now()
      const res = await fetch(ep.url, { headers: reqHeaders })
      const response_time_ms = Date.now() - start
      const bodyText = await res.text()
      let bodyParsed: any = null
      try { bodyParsed = JSON.parse(bodyText) } catch { bodyParsed = bodyText }
      const responseHeaders: Record<string, string> = {}
      res.headers.forEach((v, k) => { responseHeaders[k] = v })
      results[ep.name] = { url: ep.url, status: res.status, status_text: res.statusText, response_time_ms, headers: responseHeaders, body: bodyParsed }
    } catch (err: any) {
      results[ep.name] = { url: ep.url, error: err.message }
    }
  }

  return new Response(JSON.stringify(results, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
