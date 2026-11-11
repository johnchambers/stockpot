import { isHouseholdId, type Receipt, updateDinner } from "@/lib/db";
import { mapPins } from "@/lib/stockpot";

export const maxDuration = 60;

type Line = { item: string; local: { store: string; address?: string | null; note: string; url: string } | null };
type Body = { household: string; id: string; place?: string; basket?: { lines: Line[]; summary?: string }; receipts?: Receipt[] };

/**
 * Free: attach the shopping basket (from /api/agent/shop) and the agent's payment receipts to a
 * "tonight" page. Geocodes the local shops for the map.
 */
export async function PATCH(req: Request) {
  const b = (await req.json().catch(() => null)) as Body | null;
  if (!b || !isHouseholdId(b.household) || typeof b.id !== "string") return Response.json({ error: "`household` and `id` are required." }, { status: 400 });
  if (JSON.stringify(b).length > 100_000) return Response.json({ error: "Body too large." }, { status: 413 });
  if (b.receipts !== undefined && !(Array.isArray(b.receipts) && b.receipts.length <= 10)) return Response.json({ error: "`receipts` must be an array (max 10)." }, { status: 400 });

  let basket: (Body["basket"] & { pins?: unknown }) | undefined;
  if (b.basket) {
    if (!Array.isArray(b.basket.lines)) return Response.json({ error: "`basket.lines` must be an array." }, { status: 400 });
    const shops = b.basket.lines.flatMap((l) => (l.local ? [{ store: l.local.store, address: l.local.address ?? null }] : [])).slice(0, 8);
    basket = { ...b.basket, pins: b.place ? await mapPins(b.place, shops) : [] };
  }
  const ok = await updateDinner(b.household, b.id, { basket, receipts: b.receipts, place: b.place });
  return ok ? Response.json({ ok: true }) : Response.json({ error: "No such dinner for that household." }, { status: 404 });
}
