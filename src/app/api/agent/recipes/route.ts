import { isHouseholdId, listItems } from "@/lib/db";
import { chargeRecipes, paid } from "@/lib/mpp";
import { type InventoryLine, suggestRecipes } from "@/lib/stockpot";

export const maxDuration = 60;

type Body = { household?: string; items?: InventoryLine[]; constraints?: string };

export const POST = paid(
  chargeRecipes,
  (b) => {
    const { household, items } = b as Body;
    if (household !== undefined && !isHouseholdId(household)) return "`household` must be a Stockpot household id.";
    if (!household && !(Array.isArray(items) && items.length && items.every((i) => typeof i?.name === "string")))
      return "Send either `household` or a non-empty `items` array of { name, location }.";
    return null;
  },
  async ({ household, items, constraints }: Body) => {
    const inventory = household ? (await listItems(household)).filter((i) => i.status !== "out") : items!.map((i) => ({ ...i, location: i.location ?? "kitchen" }) as InventoryLine);
    if (inventory.length === 0) return Response.json({ error: "That household's pantry is empty. Scan something first." }, { status: 404 });
    return Response.json(await suggestRecipes(inventory, constraints));
  },
);
