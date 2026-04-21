import { Hono } from "hono";

const router = new Hono();
const API_BASE = "https://app.onlyfansapi.com/api";

router.post("/", async (c) => {
  const apiKey = process.env.ONLYFANS_API_KEY;
  if (!apiKey) return c.json({ error: "ONLYFANS_API_KEY not configured" }, 500);

  const body = await c.req.json() as any;

  if (body?.action === "call_endpoint") {
    const { url } = body;
    if (!url) return c.json({ error: "Missing url" }, 400);

    const fullUrl = url.startsWith("http") ? url : `${API_BASE}${url.startsWith("/") ? "" : "/"}${url}`;
    if (!fullUrl.startsWith("https://app.onlyfansapi.com/")) {
      return c.json({ error: "URL not allowed — only https://app.onlyfansapi.com/ endpoints permitted" }, 403);
    }

    try {
      const start = Date.now();
      const res = await fetch(fullUrl, { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" } });
      const responseTimeMs = Date.now() - start;
      const bodyText = await res.text();
      let bodyParsed: any;
      try { bodyParsed = JSON.parse(bodyText); } catch { bodyParsed = bodyText; }
      return c.json({ url: fullUrl, status: res.status, status_text: res.statusText, response_time_ms: responseTimeMs, body: bodyParsed });
    } catch (err: any) {
      return c.json({ url: fullUrl, error: err.message }, 500);
    }
  }

  return c.json({ error: "Unknown action" }, 400);
});

export default router;
