import { createClient, type Client } from "@libsql/client";

export const LOCATIONS = ["fridge", "freezer", "pantry", "cupboard", "spices"] as const;
export type Location = (typeof LOCATIONS)[number];
export type Status = "have" | "low" | "out";

export type Item = {
  id: string;
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

export async function db(): Promise<Client> {
  const c = getClient();
  ready ??= c
    .execute(
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
    )
    .then(() => undefined);
  await ready;
  return c;
}

export async function listItems(): Promise<Item[]> {
  const c = await db();
  const r = await c.execute(
    "SELECT * FROM items ORDER BY location, (est_expiry IS NULL), est_expiry, name",
  );
  return r.rows as unknown as Item[];
}

export type ScannedItem = {
  name: string;
  category: string;
  quantity: number;
  unit: string;
  shelf_life_days: number | null;
};

export type ScanDiff = { added: string[]; removed: string[]; kept: string[] };

/** Replace the "have"/"low" contents of a location with a fresh scan; return what changed. */
export async function replaceLocation(location: Location, scanned: ScannedItem[]): Promise<ScanDiff> {
  const c = await db();
  const before = await c.execute({
    sql: "SELECT name FROM items WHERE location = ? AND status != 'out'",
    args: [location],
  });
  const norm = (s: string) => s.trim().toLowerCase();
  const beforeNames = new Set(before.rows.map((r) => norm(String(r.name))));
  const afterNames = new Set(scanned.map((s) => norm(s.name)));

  const now = new Date();
  const iso = now.toISOString();
  const stmts = [
    { sql: "DELETE FROM items WHERE location = ? AND status != 'out'", args: [location] },
    ...scanned.map((s) => ({
      sql: `INSERT INTO items (id, name, category, location, quantity, unit, status, est_expiry, added_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 'have', ?, ?, ?)`,
      args: [
        crypto.randomUUID(),
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
      sql: "DELETE FROM items WHERE status = 'out' AND lower(name) = ?",
      args: [norm(s.name)],
    })),
  ];
  await c.batch(stmts, "write");

  return {
    added: [...afterNames].filter((n) => !beforeNames.has(n)),
    removed: [...beforeNames].filter((n) => !afterNames.has(n)),
    kept: [...afterNames].filter((n) => beforeNames.has(n)),
  };
}
