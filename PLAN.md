# Stockpot: Build Plan (1-hour hackathon)

> Working name taken from the Stripe project ("stockpot"). Rename once confirmed.

## Pitch
**"Before you go shopping, raid your own kitchen."**
Photograph your fridge, freezer, pantry or cupboards. Stockpot builds one household
inventory, flags what's about to expire, suggests dinners that use what you already have,
and writes the shopping list for the gaps.

## Current state
- Stripe project `stockpot` is initialised in this directory (no services yet).
- No app code and no git repo yet.
- Tooling: Node 26, npm 11, Vercel CLI, Stripe CLI and `projects` plugin v0.52.0.

## Architecture

```
Phone browser (Next.js page)
  │  photo → resized client-side to ~1024px JPEG (keeps it under Vercel's 4.5 MB body limit)
  ▼
Next.js server actions / route handlers (Vercel, Node runtime)
  ├── /api/scan     → OpenRouter vision model → structured JSON items → upsert into Turso
  ├── /api/recipes  → OpenRouter text model, given inventory (expiring first) → 3 recipes
  └── server actions → item CRUD (qty +/-, mark low/out, delete)
  ▼
Turso (libSQL / SQLite): items table
```

### Services (all via `stripe projects add`)
| Purpose | Service | Plan | Env vars (expected) |
|---|---|---|---|
| Vision + recipe LLM | `openrouter/api` | free or pay-as-you-go (question below) | `OPENROUTER_*` |
| Database | `turso/database` | starter (free) | `TURSO_*` |
| Hosting | `vercel/project` | hobby (free) | n/a, deploys from Git |

### Stack
- **Next.js (App Router, TypeScript)** with Tailwind CSS: one mobile-first app
- **AI SDK** with the OpenRouter provider, using `generateObject` and Zod schemas so scan
  results come back as typed JSON (no free-text parsing)
- **`@libsql/client`** for Turso: raw SQL, no ORM (fastest to set up)

## Data model
```sql
CREATE TABLE items (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,          -- "canned chopped tomatoes"
  category     TEXT,                   -- produce | dairy | meat | grains | canned | spices | condiments | frozen | other
  location     TEXT NOT NULL,          -- fridge | freezer | pantry | cupboard | spices
  quantity     REAL DEFAULT 1,
  unit         TEXT,                   -- "can", "bag", "g", "half"
  status       TEXT DEFAULT 'have',    -- have | low | out
  est_expiry   TEXT,                   -- ISO date, AI-estimated from category
  added_at     TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
```
**Rescan behaviour:** scanning a location replaces that location's "have" items with the new
scan. The response returns a diff (added, gone, changed) to show as "pasta gone, 2 new cans".

## Screens (single page, tabbed or stacked)
1. **Scan**: pick a location chip (Fridge, Freezer, Pantry, Cupboard, Spices), then take or
   upload a photo, then see a review list of detected items (editable), then Save.
2. **Inventory**: items grouped by location, with a "Use soon" strip at the top
   (expiry ≤ 3 days), +/- quantity buttons, and swipe or tap to mark low or out.
3. **Cook tonight**: optional constraints (time, kid-friendly, dietary). Shows 3 recipe cards,
   each with "uses: spinach (expires tomorrow), rice, canned tomatoes" and "missing: feta".
4. **Shopping list**: low and out items plus recipe gaps, grouped by aisle, with tap to check off.

## Build timeline (60 min)
| Time | Task | Done when |
|---|---|---|
| 0–8 | Scaffold Next.js app, `git init`, add OpenRouter and Turso, `stripe projects env --pull` | `npm run dev` runs, env vars present |
| 8–13 | DB client, schema migration script, seed with 5 items | Inventory query returns rows |
| 13–28 | **Scan flow**: client resize, vision call with Zod schema, review list, save, diff | Real photo yields saved items |
| 28–38 | **Inventory view** with "Use soon" strip and quantity controls | Mobile layout looks good |
| 38–46 | **Cook tonight** recipes plus **Shopping list** | 3 recipes reference real items |
| 46–54 | Push to GitHub, `stripe projects add vercel/project`, set env, deploy | Works on a phone at the public URL |
| 54–60 | Polish (empty states, loading shimmer), rehearse demo | |

**Cut order if behind:** shopping-list aisle grouping, then rescan diff, then recipe constraints,
then quantity controls. The scan → inventory → cook loop is the minimum.

## Demo script (90 s)
1. "Every family asks 'what's for dinner?' and then buys food they already have."
2. Scan a real cupboard, then scan the fridge, live on a phone.
3. Show the combined inventory, with spinach flagged under "Use soon".
4. Tap **Cook tonight**: a recipe uses spinach from the fridge plus pasta and tomatoes from the cupboard.
5. Show the shopping list with only the gaps.
6. "All the infra (DB, AI, hosting) was provisioned in one CLI with Stripe Projects."

## Decisions (confirmed)
- Name: **Stockpot**
- OpenRouter: **pay-as-you-go** (needs `stripe projects billing add` first; none is configured yet)
- Deploy: **GitHub repo (gh CLI, already logged in) + `vercel/project` via Stripe Projects**
- Stretch, in priority order: **Shopping list**, then **agentic shopping for missing items**, then **Stripe Pro upsell**

## Stretch: agentic shopping ("Shop the gaps")
From the shopping list, tap **"Find it for me"**. A tool-calling agent (AI SDK on OpenRouter):
1. Takes the missing items plus the user's location (ZIP or city entered once, no geolocation)
2. Calls tools:
   - `searchProducts` → **Channel3** (`channel3/api`, free tier) for real product listings with price and buy link
   - `searchLocalStores` → **Exa** (`exa/api`, free tier) for "<item> near <city>" at local grocers or markets
3. Streams back a **basket**: per item, the best local option and the best online option, each with price and link, plus a total
4. The user taps through to buy. **The agent does not check out on its own**: real autonomous
   purchasing needs merchant integrations and payment authorisation, which is out of scope for an hour
   and risky to demo live.

Adds about 10–12 minutes. Two extra services, both free.

## Stripe Pro upsell (last)
A Stripe Payment Link (test mode) for "Stockpot Pro: shared household + agent shopping", shown as an
upgrade card. About 5 minutes.

## Further ideas (not planned)
- Shared household via a simple invite code (`household_id` column)
- Barcode scan for single items
- Morning "use it today" nudge (Vercel cron)

## Risks and mitigations
| Risk | Mitigation |
|---|---|
| Free OpenRouter vision models are slow or inaccurate | Use pay-as-you-go with a strong, cheap vision model (costs cents) |
| Photo too large for a Vercel function | Resize client-side to ≤1024px JPEG |
| Vercel service needs a Git repo | Create a GitHub repo early, or fall back to `vercel deploy` from the CLI |
| Bad venue Wi-Fi during the demo | Pre-scan inventory beforehand and keep demo photos on the phone |

## Progress log
- [x] Services: Turso `db` (starter, aws-us-east-1), Channel3 `channel3-api` (free), Exa `exa-api` (free), Vercel `vercel-project` (hobby)
- [x] App: scan, kitchen inventory, cook tonight, shopping list, shopping agent (`/api/scan`, `/api/items`, `/api/recipes`, `/api/shop`)
- [x] GitHub: private repo `johnchambers/stockpot`; Vercel env vars set; deployed to https://stockpot-ten.vercel.app
- [x] OpenRouter: Stripe-provisioned pay-as-you-go account never received credits; using a personal key stored as Stripe Projects variable `openrouter-key` → `OPENROUTER_API_KEY`
- [x] End-to-end test: scan 15s, recipes 10s, shopping agent 15s (Claude Haiku 5.5)
- [x] Family sharing: `/h/<household-id>` links, Share button, items + scans scoped per household
- [x] Scan history: photos saved in Turso `scans` table, thumbnails on Kitchen tab
- [ ] Stripe Pro upsell (Payment Link)
- Model: `anthropic/claude-haiku-5.5` via OpenRouter (override with `STOCKPOT_MODEL`)
- Local dev runs on http://localhost:3002 (port 3000 is taken by another app)

## MPP hackathon (https://mpp-hackathon.vercel.app)
Stockpot doubles as a **paid agent API**: agents pay per call over HTTP with the Machine Payments Protocol (Tempo testnet). No API key, no checkout.

| Route | Price | What the agent buys |
|---|---|---|
| `POST /api/agent/scan` | $0.05 | Photo → food inventory (optionally synced to a family household) |
| `POST /api/agent/recipes` | $0.02 | 3 dinners from a household/inventory, expiring-first |
| `POST /api/agent/shop` | $0.10 | Shopping agent: local shops + online links for missing items |
| `GET /api/agent/pantry` | free | A household's current pantry |

- Discovery: `/openapi.json` (x-payment-info per route, generated by `mppx/nextjs` `discovery()`), `/llms.txt`
- Payments: `mppx` `tempo.charge` testnet → merchant wallet `0xa3FC3069b77F427896D8E317C214C2d335839500` (keychain account `stockpot-merchant`)
- Replay protection: `Store.sql` on Turso (`mppx_store` table)
- Secrets: Stripe Projects variables `mpp-secret` (MPP_SECRET_KEY), `mpp-recipient` (MPP_RECIPIENT)
- `npx mppx validate https://stockpot-ten.vercel.app` → **79 passed, 0 failed, 0 warnings** (with request bodies)
- **Chat interface**: `mcp/stockpot-mcp.mjs` exposes `scan_kitchen`, `whats_for_dinner`, `find_groceries`, `pantry_status`; pays via `mppx` CLI with keychain wallet `stockpot-agent` (no private key in process). Registered for Claude Code in `.mcp.json`.

Demo line: "Claude paid 17 cents to scan my fridge, plan dinner and find feta at a deli in Herne Hill, with no checkout and no API key."

---

## NEXT (not started, awaiting review): "Plan my week", the decentralised HelloFresh moment

**Goal:** one paid call (and one chat message to Claude) returns a full family week: 7 dinners, recipes, one de-duplicated shopping list, and where to buy it locally, grouped by shop with a rough cost.

> "Here's my fridge. Plan dinners for 4 this week, one vegetarian, under £80, near Herne Hill."
> → ~30–60s, one MPP payment (~$0.35), full week + list + shops.

### API: `POST /api/agent/week` (paid, proposed $0.35)
**Input**
```jsonc
{
  "household": "basil-fig-…",        // OR "image" (+ "location"), a fridge photo to scan first
  "people": "2 adults, 2 kids, one vegetarian, nut allergy",
  "servings": 4,                      // optional; derived from `people` if omitted
  "budget": { "amount": 80, "currency": "GBP" },
  "place": "Herne Hill, London",
  "nights": 7,                        // optional, 3–7
  "constraints": "weeknights ≤ 30 min" // optional
}
```
**Output**
1. `days[7]`: { day, title, minutes, servings, uses_from_kitchen[], expiring_used[], feeds: "veg-friendly; nut-free", steps[] }
2. `shopping_list[]`: { item, quantity, unit, for_days[], aisle }, minus what's already in the kitchen; ingredients shared across meals (e.g. one bag of spinach for Mon + Thu)
3. `shops[]`: { name, type (grocer|market|butcher|deli|bakery), address/note, url, items[], est_cost }, grouped by shop
4. `budget`: { estimated_total, currency, within_budget, note }
5. `coverage`: per-person notes (which nights suit the vegetarian, allergy check), with a note that cost estimates are approximate

### Pipeline (reuses existing logic)
1. **Inventory:** `listItems(household)`, or `scanPhoto(image)` if a photo is sent (and save to the household if both are given).
2. **Plan:** one structured LLM call (`generateText` + `Output.object`) creates 7 dinners, scaled servings, expiring-first, dietary/allergy rules, ingredient reuse across days. Allergy rule enforced in the prompt **and** checked after (reject/regenerate a meal that lists a banned ingredient).
3. **Consolidate list:** in code: merge duplicate ingredients across days, subtract inventory, group by aisle.
4. **Source locally:** a shopping-agent variant that searches **by shop type** ("greengrocer near Herne Hill", "butcher…", "deli…") with Exa, not per item. That's about 4–6 searches instead of 20+, so it stays inside the time budget. It assigns list items to shops and estimates cost per shop. Channel3 is only used for hard-to-find items.
5. **Respond** with receipt; optionally save the plan to the household (`plans` table) so the family app shows "This week" too.

### Surfaces
- **Paid route** `/api/agent/week` + entry in `/openapi.json` (x-payment-info) + `/llms.txt`
- **MCP tool** `plan_my_week` in `mcp/stockpot-mcp.mjs` (accepts image path or household); returns a readable week, list and shops, plus "💳 Paid $0.35"
- **(Optional) app tab** "Week" that shows a saved plan for the household (read-only; free)

### Technical notes
- `export const maxDuration = 300` (Vercel default limit is 300s; target 30–60s). Run the plan call and the shop-type searches partly in parallel where possible.
- MCP: raise the `mppx` subprocess timeout to ~240s.
- Re-run `npx mppx validate` with a `/api/agent/week` body; target is still 0 fail / 0 warn.
- Cost per call: ~2–3 Haiku calls + ~5 Exa searches, comfortably under the $0.35 price.

### Caveats (say these in the demo)
- No real orders are placed with local shops; the agent finds them and links to them.
- Prices and budget are **estimates**; LLM + web search, not live shop prices.
- Allergy handling is best-effort, not medical advice; show a note.

### Pitch / future (beyond hackathon)
Stockpot plans; many local sellers fulfil, instead of one HelloFresh warehouse. Next: local shops publish **their own MPP endpoints** (stock check / reserve / order), so the Stockpot agent pays them directly in the same request. That would make Stockpot an MPP buyer as well as a seller.

### Build estimate: ~45–60 min
| Step | Time |
|---|---|
| Week schema + planning prompt + allergy check | 15 min |
| List consolidation + shop-type sourcing | 15 min |
| Paid route, discovery, llms.txt, validate | 10 min |
| MCP `plan_my_week` + end-to-end test from chat | 10 min |
| (Optional) "Week" tab in app | 10–15 min |

### Open questions for review
1. Price: **$0.25**, **$0.35** (proposed) or **$0.50**?
2. Save plans to the household and show them in the app, or chat/API only?
3. Currency: infer from `place` (London → GBP) or always require it in `budget`?
4. Nights fixed at 7, or allow 3–7?
