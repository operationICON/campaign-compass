import "dotenv/config";
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function run() {
  await client.connect();
  console.log("Connected to Railway database");

  const migrations = [
    // daily_metrics missing columns
    `ALTER TABLE daily_metrics ADD COLUMN IF NOT EXISTS spenders integer DEFAULT 0`,
    `ALTER TABLE daily_metrics ADD COLUMN IF NOT EXISTS new_subscribers integer DEFAULT 0`,
    `ALTER TABLE daily_metrics ADD COLUMN IF NOT EXISTS new_revenue numeric DEFAULT 0`,
    `ALTER TABLE daily_metrics ADD COLUMN IF NOT EXISTS conversion_rate numeric`,
    `ALTER TABLE daily_metrics ADD COLUMN IF NOT EXISTS epc numeric`,

    // accounts missing columns (if any)
    `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_synced_at timestamptz`,
    `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS fans_last_synced_at timestamptz`,
    `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS numeric_of_id integer`,

    // unique indexes required for ON CONFLICT upserts
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_metrics_link_date ON daily_metrics (tracking_link_id, date)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_snapshots_link_date ON daily_snapshots (tracking_link_id, snapshot_date)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_tracking_links_ext_id ON tracking_links (external_tracking_link_id)`,
  ];

  for (const sql of migrations) {
    try {
      await client.query(sql);
      console.log("OK:", sql.slice(0, 60));
    } catch (err: any) {
      console.error("ERR:", sql.slice(0, 60), "→", err.message);
    }
  }

  await client.end();
  console.log("Done.");
}

run().catch(console.error);
