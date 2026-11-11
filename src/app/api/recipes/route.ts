import { generateText, Output } from "ai";
import { z } from "zod";
import { aiRoute, model, today } from "@/lib/ai";
import { listItems } from "@/lib/db";

export const maxDuration = 60;

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

export const POST = aiRoute(async (req: Request) => {
  const { constraints } = (await req.json().catch(() => ({}))) as { constraints?: string };
  const items = (await listItems()).filter((i) => i.status !== "out");
  if (items.length === 0) return Response.json({ error: "Scan something first." }, { status: 400 });

  const inventory = items
    .map((i) => `- ${i.name} (${i.quantity} ${i.unit ?? ""}, ${i.location}${i.est_expiry ? `, use by ${i.est_expiry}` : ""}${i.status === "low" ? ", running low" : ""})`)
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

  return Response.json(output);
});
