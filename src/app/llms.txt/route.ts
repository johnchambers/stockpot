import { PRICES } from "@/lib/mpp";

export function GET() {
  const text = `# Stockpot

> Stockpot turns photos of a family's fridge and cupboards into a food inventory, suggests dinners that use up what's expiring, and finds missing groceries at local shops. Agents pay per call with the Machine Payments Protocol (MPP), with no API key or account. Payments use Tempo testnet.

Builder: ${process.env.STOCKPOT_BUILDER ?? "Stockpot team"}
Discovery: https://stockpot-ten.vercel.app/openapi.json

## Paid endpoints (MPP: expect HTTP 402, pay, retry with credential, get result + Payment-Receipt)

- POST /api/agent/scan ($${PRICES.scan}): { image: data URL | https URL, location: fridge|freezer|pantry|cupboard|spices, household? } → { items[{ name, category, quantity, unit, shelf_life_days }], diff? }
- POST /api/agent/recipes ($${PRICES.recipes}): { household? | items[{ name, location? }], constraints? } → { recipes[3]{ title, minutes, why, uses, missing, steps } }
- POST /api/agent/shop ($${PRICES.shop}): { items: string[], place } → { lines[{ item, local{ store, address, note, url }, online{ title, store, price, url } }], summary }
- POST /api/agent/dish ($${PRICES.dish}): { household, recipe (one from /recipes), place? } → { id, url, image_url }: AI photo of the dish + a shareable "tonight" page

## Free endpoints

- GET /api/agent/pantry?household=<id>: current shared pantry for a family
- POST /api/agent/pair { code }: swap a one-time code from the family app ("Connect Claude") for the family's household id
- PATCH /api/agent/dinner { household, id, place?, basket?, receipts? }: attach the shop basket and payment receipts to a "tonight" page

## Typical agent flow

1. scan each storage space (pass the family's household id to sync their app)
2. recipes for that household
3. shop for the chosen recipe's missing items near the family
4. dish for the chosen recipe, then PATCH /api/agent/dinner with the basket and receipts, and show the family the tonight page
`;
  return new Response(text, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300" } });
}
