import { generateText, isStepCount, Output, tool } from "ai";
import Exa from "exa-js";
import { z } from "zod";
import { aiRoute, model } from "@/lib/ai";

export const maxDuration = 120;

type C3Product = {
  id: string;
  title: string;
  images?: { url: string; is_main_image?: boolean }[];
  offers?: { url: string; domain: string; price?: { price: number; currency: string }; availability?: string }[];
};

async function channel3Search(query: string) {
  const res = await fetch("https://api.trychannel3.com/v1/search", {
    method: "POST",
    headers: { "x-api-key": process.env.CHANNEL3_API_KEY ?? "", "content-type": "application/json" },
    body: JSON.stringify({ query, limit: 6 }),
  });
  if (!res.ok) return { error: `Channel3 ${res.status}` };
  const data = (await res.json()) as { products: C3Product[] };
  return data.products.map((p) => {
    const offer = p.offers?.find((o) => o.availability === "InStock") ?? p.offers?.[0];
    return {
      title: p.title,
      store: offer?.domain,
      price: offer?.price?.price,
      currency: offer?.price?.currency,
      url: offer?.url,
      image: (p.images?.find((i) => i.is_main_image) ?? p.images?.[0])?.url,
    };
  });
}

const exa = new Exa(process.env.EXA_API_KEY);

const BasketSchema = z.object({
  lines: z.array(
    z.object({
      item: z.string(),
      local: z
        .object({ store: z.string(), note: z.string().describe("e.g. address, opening hours, or why it's a good pick"), url: z.string() })
        .nullable(),
      online: z
        .object({ title: z.string(), store: z.string(), price: z.number().nullable(), url: z.string(), image: z.string().nullable() })
        .nullable(),
    }),
  ),
  summary: z.string().describe("1–2 sentences: where to go and an estimated online total."),
});

export const POST = aiRoute(async (req: Request) => {
  const { items, place } = (await req.json()) as { items: string[]; place: string };
  if (!items?.length) return Response.json({ error: "Nothing to shop for." }, { status: 400 });

  const { output, steps } = await generateText({
    model,
    stopWhen: isStepCount(14),
    tools: {
      searchOnline: tool({
        description: "Search an online product catalog. Returns products with store, price and a buy link. Use specific grocery-style queries like 'feta cheese block 200g'.",
        inputSchema: z.object({ query: z.string() }),
        execute: async ({ query }) => channel3Search(query),
      }),
      searchLocal: tool({
        description: "Search the web for local grocers, markets, delis or specialty shops near the user that sell an item. Returns pages with highlights.",
        inputSchema: z.object({ query: z.string().describe("e.g. 'fresh feta cheese deli near Brooklyn NY'") }),
        execute: async ({ query }) => {
          const r = await exa.search(query, { numResults: 4, contents: { highlights: true } });
          return r.results.map((x) => ({ title: x.title, url: x.url, highlights: (x as { highlights?: string[] }).highlights?.slice(0, 2) }));
        },
      }),
    },
    output: Output.object({ schema: BasketSchema }),
    prompt: `You are Stockpot's shopping agent. The user is near: ${place || "unknown location"}.
They need: ${items.join(", ")}.

For EACH item:
1. Call searchLocal to find an independent local grocer, market or specialty shop near them that likely sells it (prefer real local businesses over big chains).
2. Call searchOnline to find a good online option. ONLY accept results that are genuinely that food item (reject cookware, gifts, decor, supplements). If nothing fits, set online to null.
Batch your tool calls in parallel where possible. Never invent URLs: only use URLs returned by tools.
Then return the basket.`,
  });

  return Response.json({ ...output, toolCalls: steps.flatMap((s) => s.toolCalls).length });
});
