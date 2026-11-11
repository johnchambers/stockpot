import { db, listItems } from "@/lib/db";

export async function GET() {
  return Response.json({ items: await listItems() });
}

/** Update quantity and/or status of one item. Quantity 0 marks it "out". */
export async function PATCH(req: Request) {
  const { id, quantity, status } = (await req.json()) as { id: string; quantity?: number; status?: string };
  const c = await db();
  const now = new Date().toISOString();
  if (typeof quantity === "number") {
    const q = Math.max(0, quantity);
    await c.execute({
      sql: "UPDATE items SET quantity = ?, status = CASE WHEN ? = 0 THEN 'out' WHEN status = 'out' THEN 'have' ELSE status END, updated_at = ? WHERE id = ?",
      args: [q, q, now, id],
    });
  }
  if (status === "have" || status === "low" || status === "out") {
    await c.execute({ sql: "UPDATE items SET status = ?, updated_at = ? WHERE id = ?", args: [status, now, id] });
  }
  return Response.json({ items: await listItems() });
}

export async function DELETE(req: Request) {
  const { id } = (await req.json()) as { id: string };
  const c = await db();
  await c.execute({ sql: "DELETE FROM items WHERE id = ?", args: [id] });
  return Response.json({ items: await listItems() });
}
