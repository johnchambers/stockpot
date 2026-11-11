import { createClient, type Client } from "@libsql/client";

export const LOCATIONS = ["fridge", "freezer", "pantry", "cupboard", "spices"] as const;
export type Location = (typeof LOCATIONS)[number];
export type Status = "have" | "low" | "out";

export type Item = {
  id: string;
  household_id: string;
  name: string;
  category: string | null;
  location: Location;
  quantity: number;
  unit: string | null;
  status: Status;
  est_expiry: string | null;
  added_at: string;
  updated_at: string;
};

export type Scan = {
  id: string;
  location: Location;
  image: string; // JPEG data URL, ≤1024px (resized client-side)
  item_count: number;
  created_at: string;
};

/** Household ids are unguessable slugs; the link itself is the access token. */
export const isHouseholdId = (h: unknown): h is string => typeof h === "string" && /^[a-z0-9-]{8,48}$/.test(h);

export function householdFrom(req: Request): string | null {
  const h = new URL(req.url).searchParams.get("h");
  return isHouseholdId(h) ? h : null;
}

export const badHousehold = () => Response.json({ error: "Missing or invalid household link." }, { status: 400 });

let client: Client | null = null;
let ready: Promise<void> | null = null;

function getClient(): Client {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    if (!url) throw new Error("TURSO_DATABASE_URL is not set. Run `stripe projects env --pull`.");
    client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  return client;
}

async function migrate(c: Client) {
  await c.batch(
    [
      `CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT,
        location TEXT NOT NULL,
        quantity REAL DEFAULT 1,
        unit TEXT,
        status TEXT DEFAULT 'have',
        est_expiry TEXT,
        added_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS scans (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        location TEXT NOT NULL,
        image TEXT NOT NULL,
        item_count INTEGER NOT NULL,
        created_at TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS scans_household ON scans (household_id, created_at)",
      // "Tonight" pages: one chosen dinner with its AI dish photo, shops and agent receipts.
      `CREATE TABLE IF NOT EXISTS dinners (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        recipe TEXT NOT NULL,
        dish_image TEXT,
        scan_id TEXT,
        place TEXT,
        basket TEXT,
        receipts TEXT,
        created_at TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS dinners_household ON dinners (household_id, created_at)",
      // One-time codes that connect an agent (e.g. Claude) to an existing family.
      `CREATE TABLE IF NOT EXISTS pair_codes (
        code TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS pair_attempts (
        ip TEXT NOT NULL,
        at TEXT NOT NULL
      )`,
    ],
    "write",
  );
  // Added after launch: scope items to a household.
  const cols = await c.execute("PRAGMA table_info(items)");
  if (!cols.rows.some((r) => r.name === "household_id")) {
    await c.execute("ALTER TABLE items ADD COLUMN household_id TEXT");
  }
  await c.execute("CREATE INDEX IF NOT EXISTS items_household ON items (household_id, location)");
}

export async function db(): Promise<Client> {
  const c = getClient();
  ready ??= migrate(c).catch((e) => {
    ready = null; // retry on next request
    throw e;
  });
  await ready;
  return c;
}

export async function listItems(h: string): Promise<Item[]> {
  const c = await db();
  const r = await c.execute({
    sql: "SELECT * FROM items WHERE household_id = ? ORDER BY location, (est_expiry IS NULL), est_expiry, name",
    args: [h],
  });
  return r.rows as unknown as Item[];
}

export async function listScans(h: string, limit = 12): Promise<Scan[]> {
  const c = await db();
  const r = await c.execute({
    sql: "SELECT id, location, image, item_count, created_at FROM scans WHERE household_id = ? ORDER BY created_at DESC LIMIT ?",
    args: [h, limit],
  });
  return r.rows as unknown as Scan[];
}

export type ScannedItem = {
  name: string;
  category: string;
  quantity: number;
  unit: string;
  shelf_life_days: number | null;
};

export type ScanDiff = { added: string[]; removed: string[]; kept: string[] };

/** Replace the "have"/"low" contents of a household's location with a fresh scan, save the photo, return what changed. */
export async function replaceLocation(h: string, location: Location, scanned: ScannedItem[], image: string): Promise<ScanDiff> {
  const c = await db();
  const before = await c.execute({
    sql: "SELECT name FROM items WHERE household_id = ? AND location = ? AND status != 'out'",
    args: [h, location],
  });
  const norm = (s: string) => s.trim().toLowerCase();
  const beforeNames = new Set(before.rows.map((r) => norm(String(r.name))));
  const afterNames = new Set(scanned.map((s) => norm(s.name)));

  const now = new Date();
  const iso = now.toISOString();
  await c.batch(
    [
      { sql: "DELETE FROM items WHERE household_id = ? AND location = ? AND status != 'out'", args: [h, location] },
      ...scanned.map((s) => ({
        sql: `INSERT INTO items (id, household_id, name, category, location, quantity, unit, status, est_expiry, added_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'have', ?, ?, ?)`,
        args: [
          crypto.randomUUID(),
          h,
          s.name.trim(),
          s.category,
          location,
          s.quantity,
          s.unit,
          s.shelf_life_days == null
            ? null
            : new Date(now.getTime() + s.shelf_life_days * 86_400_000).toISOString().slice(0, 10),
          iso,
          iso,
        ],
      })),
      // Something we re-scanned is no longer "out".
      ...scanned.map((s) => ({
        sql: "DELETE FROM items WHERE household_id = ? AND status = 'out' AND lower(name) = ?",
        args: [h, norm(s.name)],
      })),
      {
        sql: "INSERT INTO scans (id, household_id, location, image, item_count, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        args: [crypto.randomUUID(), h, location, image, scanned.length, iso],
      },
    ],
    "write",
  );

  return {
    added: [...afterNames].filter((n) => !beforeNames.has(n)),
    removed: [...beforeNames].filter((n) => !afterNames.has(n)),
    kept: [...afterNames].filter((n) => beforeNames.has(n)),
  };
}

/* ---------- Tonight: a chosen dinner, its dish photo, shops and receipts ---------- */

export type Receipt = { route: string; amount: string; reference?: string | null };
export type Dinner = {
  id: string;
  household_id: string;
  recipe: unknown;
  scan_id: string | null;
  place: string | null;
  basket: unknown;
  receipts: Receipt[];
  has_dish: boolean;
  created_at: string;
};

export async function createDinner(h: string, recipe: unknown, dishImage: string | null, place: string | null): Promise<string> {
  const c = await db();
  const scan = await c.execute({ sql: "SELECT id FROM scans WHERE household_id = ? ORDER BY created_at DESC LIMIT 1", args: [h] });
  const id = crypto.randomUUID();
  await c.execute({
    sql: "INSERT INTO dinners (id, household_id, recipe, dish_image, scan_id, place, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [id, h, JSON.stringify(recipe), dishImage, scan.rows[0]?.id ?? null, place, new Date().toISOString()],
  });
  return id;
}

/** Attach the shopping basket and/or agent receipts. Returns false if the dinner isn't this household's. */
export async function updateDinner(h: string, id: string, patch: { basket?: unknown; receipts?: Receipt[]; place?: string }): Promise<boolean> {
  const c = await db();
  const r = await c.execute({
    sql: `UPDATE dinners SET
            basket = COALESCE(?, basket),
            receipts = COALESCE(?, receipts),
            place = COALESCE(?, place)
          WHERE id = ? AND household_id = ?`,
    args: [
      patch.basket === undefined ? null : JSON.stringify(patch.basket),
      patch.receipts === undefined ? null : JSON.stringify(patch.receipts),
      patch.place ?? null,
      id,
      h,
    ],
  });
  return r.rowsAffected > 0;
}

/** A household's dinner by id, or its latest one. */
export async function getDinner(h: string, id?: string | null): Promise<Dinner | null> {
  const c = await db();
  const r = await c.execute({
    sql: `SELECT id, household_id, recipe, scan_id, place, basket, receipts, dish_image IS NOT NULL AS has_dish, created_at
          FROM dinners WHERE household_id = ? ${id ? "AND id = ?" : ""} ORDER BY created_at DESC LIMIT 1`,
    args: id ? [h, id] : [h],
  });
  const row = r.rows[0];
  if (!row) return null;
  const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : null);
  return {
    id: String(row.id),
    household_id: String(row.household_id),
    recipe: parse(row.recipe),
    scan_id: (row.scan_id as string | null) ?? null,
    place: (row.place as string | null) ?? null,
    basket: parse(row.basket),
    receipts: parse(row.receipts) ?? [],
    has_dish: Boolean(row.has_dish),
    created_at: String(row.created_at),
  };
}

/** Raw image data URL for a dinner's dish photo or a scan photo (served by the image route). */
export async function getImage(h: string, kind: "dish" | "scan", id: string): Promise<string | null> {
  const c = await db();
  const r =
    kind === "dish"
      ? await c.execute({ sql: "SELECT dish_image AS img FROM dinners WHERE household_id = ? AND id = ?", args: [h, id] })
      : await c.execute({ sql: "SELECT image AS img FROM scans WHERE household_id = ? AND id = ?", args: [h, id] });
  return (r.rows[0]?.img as string | undefined) ?? null;
}

/* ---------- Pairing codes: connect an agent to an existing family ---------- */

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
export const normalizeCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** New 6-character one-time code for a household, valid for 10 minutes. Shown as "ABC-123". */
export async function createPairCode(h: string): Promise<{ code: string; expires_at: string }> {
  const c = await db();
  const raw = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
  const expires_at = new Date(Date.now() + 10 * 60_000).toISOString();
  await c.batch(
    [
      { sql: "DELETE FROM pair_codes WHERE expires_at < ? OR household_id = ?", args: [new Date().toISOString(), h] },
      { sql: "INSERT INTO pair_codes (code, household_id, expires_at) VALUES (?, ?, ?)", args: [raw, h, expires_at] },
    ],
    "write",
  );
  return { code: `${raw.slice(0, 3)}-${raw.slice(3)}`, expires_at };
}

/**
 * Swap a code for its household (one use). Rate-limited per IP: 10 tries per 10 minutes, so
 * 6-character codes (~887M combinations) can't be guessed.
 */
export async function redeemPairCode(code: string, ip: string): Promise<{ household?: string; error?: string }> {
  const c = await db();
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const tries = await c.execute({ sql: "SELECT COUNT(*) AS n FROM pair_attempts WHERE ip = ? AND at > ?", args: [ip, since] });
  if (Number(tries.rows[0]?.n ?? 0) >= 10) return { error: "Too many attempts. Wait 10 minutes and try again." };
  await c.batch(
    [
      { sql: "DELETE FROM pair_attempts WHERE at < ?", args: [since] },
      { sql: "INSERT INTO pair_attempts (ip, at) VALUES (?, ?)", args: [ip, new Date().toISOString()] },
    ],
    "write",
  );
  const r = await c.execute({
    sql: "DELETE FROM pair_codes WHERE code = ? AND expires_at > ? RETURNING household_id",
    args: [normalizeCode(code), new Date().toISOString()],
  });
  const household = r.rows[0]?.household_id as string | undefined;
  return household ? { household } : { error: "That code is wrong or has expired. Get a new one from the family app (Connect Claude)." };
}
