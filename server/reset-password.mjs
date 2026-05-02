// One-shot password reset — run with: node server/reset-password.mjs
// Delete this file after running.
import bcrypt from "bcryptjs";
import pg from "pg";

const { Client } = pg;

const EMAIL = "operation@iconmodelss.com";
const NEW_PASSWORD = "Icon@2026";
const DB_URL = "postgresql://postgres:biIrWliRpyldBjERtQRSDHWWCvQZbKsW@roundhouse.proxy.rlwy.net:35174/railway";

const hash = await bcrypt.hash(NEW_PASSWORD, 10);
const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const { rows } = await client.query(
  "UPDATE users SET password_hash = $1 WHERE email = $2 RETURNING id, email, role",
  [hash, EMAIL]
);

if (rows.length === 0) {
  const { rows: ins } = await client.query(
    "INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, 'Admin', 'admin') RETURNING id, email, role",
    [EMAIL, hash]
  );
  console.log("Created user:", ins[0]);
} else {
  console.log("Password updated for:", rows[0]);
}

await client.end();
