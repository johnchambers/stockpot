import { isHouseholdId, LOCATIONS, type Location, replaceLocation } from "@/lib/db";
import { chargeScan, paid } from "@/lib/mpp";
import { scanPhoto } from "@/lib/stockpot";

export const maxDuration = 60;

type Body = { image: string; location: Location; household?: string };

export const POST = paid(
  chargeScan,
  (b) => {
    const { image, location, household } = b as Partial<Body>;
    if (typeof image !== "string" || !(image.startsWith("data:image/") || image.startsWith("https://"))) return "`image` must be an image data URL or https URL.";
    if (image.length > 3_000_000) return "`image` is too large; resize to ≤1024px.";
    if (!LOCATIONS.includes(location as Location)) return `\`location\` must be one of ${LOCATIONS.join(", ")}.`;
    if (household !== undefined && !isHouseholdId(household)) return "`household` must be a Stockpot household id.";
    return null;
  },
  async ({ image, location, household }: Body) => {
    const items = await scanPhoto(image, location);
    // Optional: write the result into a family's shared pantry so it shows up in the app.
    const diff = household ? await replaceLocation(household, location, items, image) : undefined;
    return Response.json({ location, items, diff, household: household ?? null });
  },
);
