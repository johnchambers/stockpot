import { badHousehold, getImage, householdFrom } from "@/lib/db";

/** Serve a stored dish or scan photo as an image (they're stored as data URLs). */
export async function GET(req: Request) {
  const h = householdFrom(req);
  if (!h) return badHousehold();
  const q = new URL(req.url).searchParams;
  const kind = q.get("kind");
  const id = q.get("id");
  if ((kind !== "dish" && kind !== "scan") || !id) return Response.json({ error: "`kind` (dish|scan) and `id` are required." }, { status: 400 });
  const data = await getImage(h, kind, id);
  const m = data?.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
  if (!m) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(m[2], "base64"), {
    headers: { "content-type": m[1], "cache-control": "private, max-age=31536000, immutable" },
  });
}
