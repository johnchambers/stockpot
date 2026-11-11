import { badHousehold, createPairCode, householdFrom } from "@/lib/db";

/** Family app: create a one-time code that connects Claude (or another agent) to this household. */
export async function POST(req: Request) {
  const h = householdFrom(req);
  if (!h) return badHousehold();
  return Response.json(await createPairCode(h));
}
