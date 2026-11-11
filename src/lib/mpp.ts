import { Mppx, tempo } from "mppx/nextjs";
import { Store } from "mppx/server";
import { db } from "@/lib/db";

/** Replay protection shared across serverless instances, stored in Turso (table `mppx_store`). */
const store = Store.sql({
  dialect: "sqlite",
  query: async (sql, params) => (await (await db()).execute({ sql, args: params as never })).rows as unknown as Record<string, unknown>[],
});

/**
 * Machine Payments Protocol: agents pay per call over HTTP (402 → pay → retry with credential → result + receipt).
 * Tempo testnet for the hackathon; payments land in the Stockpot merchant wallet (MPP_RECIPIENT).
 */
export const mppx = Mppx.create({
  methods: [
    tempo.charge({
      recipient: (process.env.MPP_RECIPIENT ?? "0xa3FC3069b77F427896D8E317C214C2d335839500") as `0x${string}`,
      testnet: true,
      store,
    }),
  ],
  secretKey: process.env.MPP_SECRET_KEY!,
  realm: process.env.MPP_REALM ?? "stockpot-ten.vercel.app",
});

export const PRICES = { scan: "0.05", recipes: "0.02", shop: "0.10", dish: "0.03" } as const;

export const chargeScan = mppx.charge({ amount: PRICES.scan, description: "Stockpot: scan a fridge/pantry photo into a food inventory" });
export const chargeRecipes = mppx.charge({ amount: PRICES.recipes, description: "Stockpot: 3 dinners from an inventory, prioritising what expires soonest" });
export const chargeShop = mppx.charge({ amount: PRICES.shop, description: "Stockpot: agent finds missing groceries at local shops and online" });
export const chargeDish = mppx.charge({ amount: PRICES.dish, description: "Stockpot: AI photo of tonight's dinner and a shareable 'tonight' page for the family" });

type Handler = (req: Request) => Promise<Response> | Response;

/**
 * Gate a handler behind a charge. The credential is always checked first (MPP semantics: no/malformed
 * credential → 402 challenge). Input is validated after payment; the request schemas are published in
 * /openapi.json so well-behaved agents (and our MCP tools) validate before paying.
 */
export function paid(charge: (h: Handler) => Handler, validate: (body: unknown) => string | null, handler: (body: never, req: Request) => Promise<Response>): Handler {
  const gated = charge(async (req) => {
    const body = await req.json().catch(() => null);
    const problem = body == null ? "Body must be JSON. See /openapi.json for the request schema." : validate(body);
    if (problem) return Response.json({ error: problem, schema: "/openapi.json" }, { status: 400 });
    try {
      return await handler(body as never, req);
    } catch (e) {
      console.error(e);
      return Response.json({ error: e instanceof Error ? e.message : "Something went wrong" }, { status: 500 });
    }
  });
  return async (req: Request): Promise<Response> => gated(req);
}
