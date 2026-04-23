import { Hono } from "hono";
import { db } from "../../db/client.js";
import { transactions, accounts, sync_logs } from "../../db/schema.js";
import { eq, sql } from "drizzle-orm";
import { createSSEStream, sseHeaders } from "../../lib/sse.js";

const router = new Hono();

router.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const triggeredBy = body.triggered_by ?? "manual";
  const { stream, send, close } = createSSEStream();

  const [syncLog] = await db.insert(sync_logs).values({
    started_at: new Date(), status: "running", success: false,
    triggered_by: `revenue_breakdown_sync_${triggeredBy}`,
    message: "Revenue breakdown sync started", records_processed: 0,
  }).returning();
  const syncLogId = syncLog?.id;

  (async () => {
    let accountsUpdated = 0;
    try {
      await send({ step: "start", message: "Aggregating transaction type totals..." });

      // Sum revenue by account_id and type from transactions table
      const rows = await db
        .select({
          account_id: transactions.account_id,
          type: transactions.type,
          total: sql<string>`COALESCE(SUM(${transactions.revenue}::numeric), 0)`,
        })
        .from(transactions)
        .groupBy(transactions.account_id, transactions.type);

      await send({ step: "computed", message: `${rows.length} type-account pairs found` });

      // Aggregate per account
      const byAccount: Record<string, { messages: number; tips: number; subscriptions: number; posts: number }> = {};
      for (const row of rows) {
        if (!row.account_id) continue;
        const id = row.account_id;
        if (!byAccount[id]) byAccount[id] = { messages: 0, tips: 0, subscriptions: 0, posts: 0 };
        const v = Number(row.total ?? 0);
        const t = (row.type ?? "").toLowerCase();
        if (t === "message" || t === "messages" || t === "ppv" || t === "chat") byAccount[id].messages += v;
        else if (t === "tip" || t === "tips")                                   byAccount[id].tips += v;
        else if (t === "subscription" || t === "subscriptions" || t === "sub")  byAccount[id].subscriptions += v;
        else if (t === "post" || t === "posts")                                 byAccount[id].posts += v;
      }

      const accountIds = Object.keys(byAccount);
      await send({ step: "updating", message: `Updating ${accountIds.length} accounts...` });

      for (const accountId of accountIds) {
        const b = byAccount[accountId];
        const total = b.messages + b.tips + b.subscriptions + b.posts;
        await db.update(accounts)
          .set({
            ltv_messages:      String(b.messages),
            ltv_tips:          String(b.tips),
            ltv_subscriptions: String(b.subscriptions),
            ltv_posts:         String(b.posts),
            ltv_total:         String(total),
            ltv_updated_at:    new Date(),
          })
          .where(eq(accounts.id, accountId));
        accountsUpdated++;
      }

      if (syncLogId) await db.update(sync_logs).set({
        status: "success", success: true,
        finished_at: new Date(), completed_at: new Date(),
        records_processed: accountsUpdated,
        message: `${accountsUpdated} accounts updated`,
      }).where(eq(sync_logs.id, syncLogId));

      await send({ step: "done", message: `${accountsUpdated} accounts updated`, accounts_updated: accountsUpdated });
    } catch (err: any) {
      if (syncLogId) await db.update(sync_logs).set({
        status: "error", success: false,
        finished_at: new Date(), completed_at: new Date(),
        error_message: err.message,
      }).where(eq(sync_logs.id, syncLogId));
      await send({ step: "error", error: err.message });
    } finally { close(); }
  })();

  return new Response(stream, { headers: sseHeaders });
});

export default router;
