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
