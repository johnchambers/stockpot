import { badHousehold, getDinner, householdFrom } from "@/lib/db";

/** The household's latest "tonight" dinner, or a specific one with ?d=<id>. */
export async function GET(req: Request) {
  const h = householdFrom(req);
  if (!h) return badHousehold();
  const dinner = await getDinner(h, new URL(req.url).searchParams.get("d"));
  return dinner ? Response.json({ dinner }) : Response.json({ error: "No dinner planned yet." }, { status: 404 });
}
