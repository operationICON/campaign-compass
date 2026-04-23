import { Hono } from "hono";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

type Env = { Variables: { jwtPayload: any } };
const router = new Hono<Env>();

function getSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET not configured");
  return s;
}

function verifyToken(header: string | undefined): any {
  if (!header?.startsWith("Bearer ")) return null;
  try { return jwt.verify(header.slice(7), getSecret()); } catch { return null; }
}

async function requireAuth(c: any, next: any) {
  const payload = verifyToken(c.req.header("Authorization"));
  if (!payload) return c.json({ error: "Unauthorized" }, 401);
  c.set("jwtPayload", payload);
  await next();
}

async function requireAdmin(c: any, next: any) {
  const payload = verifyToken(c.req.header("Authorization"));
  if (!payload) return c.json({ error: "Unauthorized" }, 401);
  if (payload.role !== "admin") return c.json({ error: "Forbidden" }, 403);
  c.set("jwtPayload", payload);
  await next();
}

// POST /auth/login
router.post("/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { email, password } = body;
  if (!email || !password) return c.json({ error: "Email and password required" }, 400);

  const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase().trim()));
  if (!user) return c.json({ error: "Invalid credentials" }, 401);

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return c.json({ error: "Invalid credentials" }, 401);

  const token = jwt.sign(
    { sub: user.id, email: user.email, role: user.role, name: user.name },
    getSecret(),
    { expiresIn: "24h" }
  );
  await db.update(users).set({ last_login_at: new Date() }).where(eq(users.id, user.id));
  return c.json({ token, user: { id: user.id, email: user.email, role: user.role, name: user.name } });
});

// GET /auth/me
router.get("/me", requireAuth, (c) => {
  const p = c.get("jwtPayload");
  return c.json({ user: { id: p.sub, email: p.email, role: p.role, name: p.name } });
});

// GET /auth/users (admin only)
router.get("/users", requireAdmin, async (c) => {
  const all = await db.select({
    id: users.id, email: users.email, name: users.name,
    role: users.role, created_at: users.created_at, last_login_at: users.last_login_at,
  }).from(users).orderBy(users.created_at);
  return c.json(all);
});

// POST /auth/users (admin only)
router.post("/users", requireAdmin, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { email, password, name, role } = body;
  if (!email || !password || !name) return c.json({ error: "email, password, and name are required" }, 400);
  if (!["admin", "user"].includes(role)) return c.json({ error: "role must be admin or user" }, 400);

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email.toLowerCase().trim()));
  if (existing.length > 0) return c.json({ error: "Email already exists" }, 409);

  const password_hash = await bcrypt.hash(password, 10);
  const [newUser] = await db.insert(users).values({
    email: email.toLowerCase().trim(), password_hash, name, role,
  }).returning({ id: users.id, email: users.email, name: users.name, role: users.role, created_at: users.created_at });
  return c.json(newUser, 201);
});

// PUT /auth/users/:id (admin only)
router.put("/users/:id", requireAdmin, async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const updates: Record<string, any> = {};
  if (body.name) updates.name = body.name;
  if (body.role && ["admin", "user"].includes(body.role)) updates.role = body.role;
  if (body.password) updates.password_hash = await bcrypt.hash(body.password, 10);
  if (Object.keys(updates).length === 0) return c.json({ error: "Nothing to update" }, 400);

  const [updated] = await db.update(users).set(updates).where(eq(users.id, id))
    .returning({ id: users.id, email: users.email, name: users.name, role: users.role });
  if (!updated) return c.json({ error: "User not found" }, 404);
  return c.json(updated);
});

// DELETE /auth/users/:id (admin only)
router.delete("/users/:id", requireAdmin, async (c) => {
  const id = c.req.param("id");
  const [deleted] = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id });
  if (!deleted) return c.json({ error: "User not found" }, 404);
  return c.json({ ok: true });
});

export default router;
