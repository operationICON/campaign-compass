import "dotenv/config";
import pg from "pg";
import bcrypt from "bcryptjs";

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

    // tracking_links computed metric columns
    `ALTER TABLE tracking_links ADD COLUMN IF NOT EXISTS spenders integer DEFAULT 0`,
    `ALTER TABLE tracking_links ADD COLUMN IF NOT EXISTS cvr numeric`,
    `ALTER TABLE tracking_links ADD COLUMN IF NOT EXISTS arpu numeric`,
    `ALTER TABLE tracking_links ADD COLUMN IF NOT EXISTS ltv numeric`,
    `ALTER TABLE tracking_links ADD COLUMN IF NOT EXISTS ltv_per_sub numeric`,
    `ALTER TABLE tracking_links ADD COLUMN IF NOT EXISTS spender_rate numeric`,

    // unique indexes required for ON CONFLICT upserts
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_metrics_link_date ON daily_metrics (tracking_link_id, date)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_snapshots_link_date ON daily_snapshots (tracking_link_id, snapshot_date)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_tracking_links_ext_id ON tracking_links (external_tracking_link_id)`,

    // users table
    `CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      name text NOT NULL,
      role text NOT NULL DEFAULT 'user',
      created_at timestamptz NOT NULL DEFAULT now(),
      last_login_at timestamptz
    )`,
  ];

  for (const sql of migrations) {
    try {
      await client.query(sql);
      console.log("OK:", sql.trim().slice(0, 60));
    } catch (err: any) {
      console.error("ERR:", sql.trim().slice(0, 60), "→", err.message);
    }
  }

  // Seed default admin user
  try {
    const hash = await bcrypt.hash("Icon@2024", 10);
    await client.query(
      `INSERT INTO users (email, password_hash, name, role)
       VALUES ('operation@iconmodelss.com', $1, 'Operation Admin', 'admin')
       ON CONFLICT (email) DO NOTHING`,
      [hash]
    );
    console.log("OK: seed admin user operation@iconmodelss.com");
  } catch (err: any) {
    console.error("ERR: seed admin user →", err.message);
  }

  await client.end();
  console.log("Done.");
}

run().catch(console.error);
