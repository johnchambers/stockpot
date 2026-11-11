import { chargeShop, paid } from "@/lib/mpp";
import { buildBasket } from "@/lib/stockpot";

export const maxDuration = 120;

type Body = { items: string[]; place: string };

export const POST = paid(
  chargeShop,
  (b) => {
    const { items, place } = b as Partial<Body>;
    if (!Array.isArray(items) || !items.length || items.length > 10 || !items.every((i) => typeof i === "string")) return "`items` must be 1–10 strings.";
    if (typeof place !== "string" || !place.trim()) return "`place` (town, neighbourhood or ZIP) is required.";
    return null;
  },
  async ({ items, place }: Body) => Response.json(await buildBasket(items, place)),
);
