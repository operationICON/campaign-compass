import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import accountsRouter from "./routes/accounts.js";
import campaignsRouter from "./routes/campaigns.js";
import onlytrafficOrdersRouter from "./routes/onlytraffic-orders.js";
import fansRouter from "./routes/fans.js";
import manualNotesRouter from "./routes/manual-notes.js";
import trackingLinksRouter from "./routes/tracking-links.js";
import syncLogsRouter from "./routes/sync-logs.js";
import alertsRouter from "./routes/alerts.js";
import notificationsRouter from "./routes/notifications.js";
import transactionsRouter from "./routes/transactions.js";
import dailyMetricsRouter from "./routes/daily-metrics.js";
import dailySnapshotsRouter from "./routes/daily-snapshots.js";
import trackingLinkLtvRouter from "./routes/tracking-link-ltv.js";
import trafficSourcesRouter from "./routes/traffic-sources.js";
import sourceTagRulesRouter from "./routes/source-tag-rules.js";
import syncSettingsRouter from "./routes/sync-settings.js";
import adSpendRouter from "./routes/ad-spend.js";
import debugRouter from "./routes/debug.js";
import syncOrchestratorRouter from "./routes/sync/orchestrator.js";
import syncAccountRouter from "./routes/sync/account.js";
import syncSnapshotsRouter from "./routes/sync/snapshots.js";
import syncOnlytrafficRouter from "./routes/sync/onlytraffic.js";
import syncCrosspollRouter from "./routes/sync/crosspoll.js";
import syncRevenueBreakdownRouter from "./routes/sync/revenue-breakdown.js";
import syncCancelRouter from "./routes/sync/cancel.js";
import authRouter from "./routes/auth.js";
import { startScheduler } from "./scheduler.js";

const app = new Hono();

const allowedOrigins = (process.env.FRONTEND_ORIGIN ?? "http://localhost:8080,http://localhost:5173").split(",").map(s => s.trim());

app.use("*", cors({
  origin: (origin) => {
    if (!origin) return allowedOrigins[0];
    if (allowedOrigins.includes(origin)) return origin;
    // Allow all localhost ports in development
    if (origin.startsWith("http://localhost:")) return origin;
    return allowedOrigins[0];
  },
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400,
}));

app.use("*", logger());

app.get("/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));
app.route("/auth", authRouter);

app.route("/accounts", accountsRouter);
app.route("/campaigns", campaignsRouter);
app.route("/onlytraffic-orders", onlytrafficOrdersRouter);
app.route("/fans", fansRouter);
app.route("/manual-notes", manualNotesRouter);
app.route("/tracking-links", trackingLinksRouter);
app.route("/sync-logs", syncLogsRouter);
app.route("/alerts", alertsRouter);
app.route("/notifications", notificationsRouter);
app.route("/transactions", transactionsRouter);
app.route("/daily-metrics", dailyMetricsRouter);
app.route("/daily-snapshots", dailySnapshotsRouter);
app.route("/tracking-link-ltv", trackingLinkLtvRouter);
app.route("/traffic-sources", trafficSourcesRouter);
app.route("/source-tag-rules", sourceTagRulesRouter);
app.route("/sync-settings", syncSettingsRouter);
app.route("/ad-spend", adSpendRouter);
app.route("/debug", debugRouter);
app.route("/sync/orchestrate", syncOrchestratorRouter);
app.route("/sync/account", syncAccountRouter);
app.route("/sync/snapshots", syncSnapshotsRouter);
app.route("/sync/onlytraffic", syncOnlytrafficRouter);
app.route("/sync/crosspoll", syncCrosspollRouter);
app.route("/sync/revenue-breakdown", syncRevenueBreakdownRouter);
app.route("/sync/cancel", syncCancelRouter);

const port = Number(process.env.PORT ?? 3000);
console.log(`Server starting on port ${port}`);

serve({ fetch: app.fetch, port });
startScheduler();
