import { aiRoute } from "@/lib/ai";
import { badHousehold, householdFrom, listItems } from "@/lib/db";
import { suggestRecipes } from "@/lib/stockpot";

export const maxDuration = 60;

export const POST = aiRoute(async (req: Request) => {
  const h = householdFrom(req);
  if (!h) return badHousehold();
  const { constraints } = (await req.json().catch(() => ({}))) as { constraints?: string };
  const items = (await listItems(h)).filter((i) => i.status !== "out");
  if (items.length === 0) return Response.json({ error: "Scan something first." }, { status: 400 });
  return Response.json(await suggestRecipes(items, constraints));
});
