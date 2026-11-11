import { discovery } from "mppx/nextjs";
import { chargeDish, chargeRecipes, chargeScan, chargeShop, mppx } from "@/lib/mpp";

const json = (schema: Record<string, unknown>) => ({ required: true, content: { "application/json": { schema } } });
const household = { type: "string", description: "Optional Stockpot household id (from a family share link /h/<id>). Results sync to that family's pantry." };

export const GET = discovery(mppx, {
  info: { title: "Stockpot Agent API", version: "1.0.0" },
  serviceInfo: {
    categories: ["food", "ai", "shopping"],
    docs: { homepage: "https://stockpot-ten.vercel.app", llms: "https://stockpot-ten.vercel.app/llms.txt" },
  },
  routes: [
    {
      handler: chargeScan,
      method: "post",
      path: "/api/agent/scan",
      summary: "Scan a photo of a fridge, freezer, pantry, cupboard or spice rack into a structured food inventory.",
      requestBody: json({
        type: "object",
        required: ["image", "location"],
        properties: {
          image: { type: "string", description: "JPEG/PNG as a data URL (≤1024px recommended) or an https image URL." },
          location: { type: "string", enum: ["fridge", "freezer", "pantry", "cupboard", "spices"] },
          household,
        },
      }),
    },
    {
      handler: chargeRecipes,
      method: "post",
      path: "/api/agent/recipes",
      summary: "Suggest 3 dinners that use what's in the kitchen, prioritising items that expire soonest. Lists missing ingredients.",
      requestBody: json({
        type: "object",
        properties: {
          household,
          items: { type: "array", description: "Inventory, if no household.", items: { type: "object", required: ["name"], properties: { name: { type: "string" }, location: { type: "string" }, est_expiry: { type: "string", format: "date" } } } },
          constraints: { type: "string", description: "e.g. '30 min, vegetarian, kid-friendly'" },
        },
      }),
    },
    {
      handler: chargeShop,
      method: "post",
      path: "/api/agent/shop",
      summary: "Shopping agent: find missing groceries at independent local shops near a place, plus online buy links.",
      requestBody: json({
        type: "object",
        required: ["items", "place"],
        properties: { items: { type: "array", items: { type: "string" }, maxItems: 10 }, place: { type: "string", description: "Town, neighbourhood or ZIP" } },
      }),
    },
    {
      handler: chargeDish,
      method: "post",
      path: "/api/agent/dish",
      summary: "AI photo of a chosen dinner plus a shareable 'tonight' page for the family (scanned fridge, recipe, dish, shops, receipts).",
      requestBody: json({
        type: "object",
        required: ["household", "recipe"],
        properties: {
          household: { type: "string", description: "Stockpot household id (from a family share link /h/<id>)." },
          recipe: { type: "object", required: ["title"], description: "One recipe from /api/agent/recipes.", properties: { title: { type: "string" } } },
          place: { type: "string", description: "Town, neighbourhood or ZIP, for the shop map" },
        },
      }),
    },
  ],
});
