import { generateText, Output } from "ai";
import { z } from "zod";
import { aiRoute, model } from "@/lib/ai";
import { LOCATIONS, replaceLocation } from "@/lib/db";

export const maxDuration = 60;

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

export const POST = aiRoute(async (req: Request) => {
  const { image, location } = (await req.json()) as { image: string; location: string };
  if (!image?.startsWith("data:image/")) return Response.json({ error: "Expected an image data URL" }, { status: 400 });
  if (!LOCATIONS.includes(location as never)) return Response.json({ error: "Unknown location" }, { status: 400 });

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

  const diff = await replaceLocation(location as (typeof LOCATIONS)[number], output.items);
  return Response.json({ items: output.items, diff });
});
