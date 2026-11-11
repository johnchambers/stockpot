import { generateText, isStepCount, Output, tool } from "ai";
import Exa from "exa-js";
import { z } from "zod";
import { model, today } from "@/lib/ai";
import type { Item, Location, ScannedItem } from "@/lib/db";

/* Core Stockpot capabilities, shared by the family app (free) and the MPP agent API (paid). */

const ScanSchema = z.object({
  items: z.array(
    z.object({
      name: z.string().describe("Generic food name, singular, lowercase, e.g. 'chopped tomatoes'. No brand."),
      category: z.enum(["produce", "dairy", "meat", "fish", "bakery", "grains", "canned", "spices", "condiments", "snacks", "frozen", "drinks", "other"]),
      quantity: z.number().describe("Count of units, or a fraction for partly used packs, e.g. 0.5"),
      unit: z.string().describe("e.g. 'can', 'bag', 'jar', 'bottle', 'pack', 'each', 'bunch'"),
      shelf_life_days: z.number().nullable().describe("Typical remaining days before it should be used, given where it is stored. null for long-life items like dry pasta or spices."),
    }),
  ),
});

/** Photo of a storage space → structured food inventory. */
export async function scanPhoto(image: string, location: Location): Promise<ScannedItem[]> {
  const { output } = await generateText({
    model,
    output: Output.object({ schema: ScanSchema }),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `This is a photo of a household ${location}. List every distinct food or drink item you can identify. Merge duplicates into one entry with a quantity. Ignore non-food objects. If you can't read a label, make your best generic guess (e.g. "canned beans").`,
          },
          { type: "image", image },
        ],
      },
    ],
  });
  return output.items;
}

const RecipesSchema = z.object({
  recipes: z
    .array(
      z.object({
        title: z.string(),
        minutes: z.number(),
        why: z.string().describe("One short sentence on why this is a good pick tonight, e.g. which items it rescues."),
        uses: z.array(z.object({ name: z.string(), location: z.string(), expiring: z.boolean() })),
        missing: z.array(z.string()).describe("Ingredients NOT in the inventory. Keep this short; ignore salt, pepper, oil, water."),
        steps: z.array(z.string()).max(6),
      }),
    )
    .length(3),
});

export type InventoryLine = Pick<Item, "name" | "location"> & Partial<Pick<Item, "quantity" | "unit" | "est_expiry" | "status">>;

/** Inventory → 3 dinners that use what's expiring, plus what's missing. */
export async function suggestRecipes(items: InventoryLine[], constraints?: string) {
  const inventory = items
    .map((i) => `- ${i.name} (${i.quantity ?? 1} ${i.unit ?? ""}, ${i.location}${i.est_expiry ? `, use by ${i.est_expiry}` : ""}${i.status === "low" ? ", running low" : ""})`)
    .join("\n");
  const { output } = await generateText({
    model,
    output: Output.object({ schema: RecipesSchema }),
    prompt: `Today is ${today()}. Suggest 3 realistic home dinners using this household's inventory.
Strongly prefer items expiring soonest. Combine ingredients from different storage spots (fridge + pantry + cupboard).
Minimise missing ingredients.${constraints ? `\nConstraints: ${constraints}` : ""}

Inventory:
${inventory}`,
  });
  return output;
}

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

/** Missing items + location → agent-built basket of local shops and online buy links. */
export async function buildBasket(items: string[], place: string) {
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
  return { ...output, toolCalls: steps.flatMap((s) => s.toolCalls).length };
}
