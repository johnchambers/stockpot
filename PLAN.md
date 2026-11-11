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
