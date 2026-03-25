import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Auto-tagging has been permanently disabled.
// Source tags are now managed manually by users only.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  return new Response(JSON.stringify({
    tagged: 0,
    skipped: 0,
    untagged: 0,
    message: 'Auto-tagging is disabled. Source tags are managed manually.',
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
