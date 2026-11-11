import { aiRoute } from "@/lib/ai";
import { badHousehold, householdFrom, LOCATIONS, type Location, replaceLocation } from "@/lib/db";
import { scanPhoto } from "@/lib/stockpot";

export const maxDuration = 60;

export const POST = aiRoute(async (req: Request) => {
  const h = householdFrom(req);
  if (!h) return badHousehold();
  const { image, location } = (await req.json()) as { image: string; location: string };
  if (!image?.startsWith("data:image/") || image.length > 3_000_000) return Response.json({ error: "Expected an image data URL" }, { status: 400 });
  if (!LOCATIONS.includes(location as never)) return Response.json({ error: "Unknown location" }, { status: 400 });

  const items = await scanPhoto(image, location as Location);
  const diff = await replaceLocation(h, location as Location, items, image);
  return Response.json({ items, diff });
});
