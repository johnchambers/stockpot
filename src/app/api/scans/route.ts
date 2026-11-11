import { badHousehold, householdFrom, listScans } from "@/lib/db";

export async function GET(req: Request) {
  const h = householdFrom(req);
  if (!h) return badHousehold();
  return Response.json({ scans: await listScans(h) });
}
