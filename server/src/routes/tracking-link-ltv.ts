import { Hono } from "hono";
import { db } from "../db/client.js";
import { tracking_link_ltv } from "../db/schema.js";

const router = new Hono();

router.get("/", async (c) => {
  const rows = await db.select().from(tracking_link_ltv);
  return c.json(rows);
});

export default router;
