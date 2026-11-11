import { aiRoute } from "@/lib/ai";
import { buildBasket } from "@/lib/stockpot";

export const maxDuration = 120;

export const POST = aiRoute(async (req: Request) => {
  const { items, place } = (await req.json()) as { items: string[]; place: string };
  if (!items?.length) return Response.json({ error: "Nothing to shop for." }, { status: 400 });
  return Response.json(await buildBasket(items, place));
});
