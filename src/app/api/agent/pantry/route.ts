import { isHouseholdId, listItems } from "@/lib/db";

/** Free: read a household's current pantry (agents use this to decide what to buy). */
export async function GET(req: Request) {
  const household = new URL(req.url).searchParams.get("household");
  if (!isHouseholdId(household)) return Response.json({ error: "`household` query param required." }, { status: 400 });
  const items = await listItems(household);
  return Response.json({
    household,
    items: items.map(({ name, location, quantity, unit, status, est_expiry }) => ({ name, location, quantity, unit, status, est_expiry })),
  });
}
