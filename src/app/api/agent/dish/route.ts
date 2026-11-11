import { createDinner, isHouseholdId } from "@/lib/db";
import { chargeDish, paid } from "@/lib/mpp";
import { dishPhoto, type DishRecipe } from "@/lib/stockpot";

export const maxDuration = 120;

type Body = { household: string; recipe: DishRecipe & Record<string, unknown>; place?: string };

/** Paid (MPP): photo of the finished dish + a "tonight" page for the family (recipe, scanned fridge, dish). */
export const POST = paid(
  chargeDish,
  (b) => {
    const { household, recipe, place } = b as Partial<Body>;
    if (!isHouseholdId(household)) return "`household` (a Stockpot household id) is required.";
    if (!recipe || typeof recipe.title !== "string" || !recipe.title.trim()) return "`recipe` must be an object with a `title` (use one from /api/agent/recipes).";
    if (JSON.stringify(recipe).length > 20_000) return "`recipe` is too large.";
    if (place !== undefined && typeof place !== "string") return "`place` must be a string.";
    return null;
  },
  async ({ household, recipe, place }: Body, req) => {
    const BASE = new URL(req.url).origin;
    const image = await dishPhoto(recipe);
    const id = await createDinner(household, recipe, image, place?.trim() || null);
    return Response.json({ id, household, url: `${BASE}/h/${household}/tonight?d=${id}`, image_url: `${BASE}/api/img?h=${household}&kind=dish&id=${id}` });
  },
);
