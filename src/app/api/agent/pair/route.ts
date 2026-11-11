import { redeemPairCode } from "@/lib/db";

/** Free: swap a one-time code from the family app ("Connect Claude") for the family's household id. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
  if (typeof body?.code !== "string" || !body.code.trim()) return Response.json({ error: "`code` is required, e.g. \"FGK-482\"." }, { status: 400 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const r = await redeemPairCode(body.code, ip);
  if (r.error) return Response.json({ error: r.error }, { status: r.error.startsWith("Too many") ? 429 : 404 });
  return Response.json({ household: r.household });
}
