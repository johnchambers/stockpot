<!-- stripe-projects-cli managed:agents-md:start -->
## Stripe Projects CLI

This repository is initialized for the Stripe project "stockpot".

## Tools used

- [Stripe CLI](https://docs.stripe.com/stripe-cli) with the `projects` plugin to manage third-party services, credentials, and deployments for this project. Use the stripe-projects-cli to manage deploying and access to third party services.
<!-- stripe-projects-cli managed:agents-md:end -->

## Stockpot: project context (keep this up to date)

Full build plan and history: `PLAN.md`. This section is the short version so a new session doesn't lose context.

**What it is:** photograph your fridge/freezer/pantry → household food inventory → dinners that use what expires first → shopping agent finds the missing bits at independent local shops. Also sold as a **paid agent API over MPP** (Machine Payments Protocol) for the MPP hackathon (https://mpp-hackathon.vercel.app).

**Live:** https://stockpot-ten.vercel.app (private GitHub repo `johnchambers/stockpot`, deployed on Vercel). Local dev runs on http://localhost:3002 (port 3000 is taken).

**Stack / services (all via Stripe Projects):** Next.js App Router on Vercel, Turso (libSQL) DB, OpenRouter (`anthropic/claude-haiku-5.5`, personal key in Stripe Projects variable `openrouter-key`; the Stripe-provisioned OpenRouter account never got credits), Exa (local shop search), Channel3 (online products).

**Family households:** shareable `/h/<id>` links; items and scan photos are scoped per household. Demo household: `thyme-fig-tuvtmv`.

### MPP agent API (Tempo testnet)
| Route | Price |
|---|---|
| `POST /api/agent/scan` | $0.05 |
| `POST /api/agent/recipes` | $0.02 |
| `POST /api/agent/shop` | $0.10 |
| `POST /api/agent/dish` | $0.03 (AI dish photo via `black-forest-labs/flux-3-image-klein`, ~7s; creates a "tonight" page) |
| `GET /api/agent/pantry` | free |
| `POST /api/agent/pair` | free (one-time code → household id; 10 tries/10 min per IP) |
| `PATCH /api/agent/dinner` | free (attach basket + receipts to a tonight page; geocodes shops via Nominatim) |
- Payment config: `src/lib/mpp.ts` (`mppx/nextjs`, `tempo.charge` testnet only, replay store in Turso `mppx_store`). Secrets: Stripe Projects variables `mpp-secret`, `mpp-recipient`.
- Discovery: `/openapi.json` (x-payment-info per route), `/llms.txt`. `npx mppx validate https://stockpot-ten.vercel.app` → 79 passed, 0 failed.

### Hackathon status (checked 2026-11-11)
- ✅ Must: public, accepts payment, returns result + receipt. Live 402 has `WWW-Authenticate: Payment`.
- ✅ `/openapi.json`, `/llms.txt`, `mppx validate`, MCP tools (optional item).
- ⚠️ Not confirmed whether it has been submitted on the hackathon Submit page yet.
- ❌ Optional: real payment (Stripe card via Shared Payment Token, or Tempo mainnet) and "more than one way to pay". The site says "then switch to a real payment" but it is not in the Must or submission lists. **Decision: submit on testnet; add a Stripe card method only if there is time.**

### Claude chat interface (MCP)
- `mcp/stockpot-mcp.mjs`, registered in `.mcp.json` as `stockpot`. Tools: `scan_kitchen`, `whats_for_dinner`, `find_groceries`, `pantry_status`. Pays through the `mppx` CLI with keychain wallet `stockpot-agent` (no private key in process). Prints a "💳 Paid $x · session total" line.
- **Demo input = drag the photo into the terminal.** `scan_kitchen` cleans dragged paths (quotes, `\ ` escapes, `file://`, `~`). If `image` is omitted it scans the built-in demo photo `mcp/demo-fridge.jpeg` (copied from `~/Desktop/food2.jpeg`; source unknown, swap for an own photo before showing publicly). `location` defaults to `fridge`. Missing file → clear error, no charge. If an image is attached without a visible path, ask for the path rather than silently using the demo photo.
- After editing the MCP server, reconnect it (`/mcp` → stockpot) or restart Claude Code; the running process keeps the old code.
- MCP tools can't receive an image dropped into chat as pixels; they need a path or https URL.

### Family setup, pairing and the "tonight" page (built 2026-11-11, local only until deployed)
- MCP remembers the connected family in `~/.stockpot/config.json` (override path with `STOCKPOT_CONFIG`). No family → tools return instructions to ask "Do you already have a Stockpot family?" → `family` tool: `create` | `join` (code or share link) | `status` | `forget`.
- Family app header: "Connect Claude" button shows a one-time code (6 chars, 10 min, `pair_codes` table) and a "Tonight's dinner" link.
- `fridge_to_dinner` MCP tool: scan → recipes (picks the one rescuing most expiring food) → dish photo + shops in parallel → PATCH dinner → opens `/h/<id>/tonight?d=<id>` in the browser (`STOCKPOT_OPEN_BROWSER=0` disables). ~40s, ~$0.20.
- Tonight page (`src/app/h/[id]/tonight/`): animated before/after slider (fridge scan → dish), rescued items, method, Leaflet map (CARTO tiles) with numbered shop pins + Google Maps walking-route link, receipts linked to `explore.testnet.tempo.xyz`.
- New tables: `dinners`, `pair_codes`, `pair_attempts`. Images served from `/api/img?h=&kind=dish|scan&id=`.
- Dev gotcha: Turbopack sometimes keeps a stale copy of `src/lib/stockpot.ts` in route bundles; a real content edit (not `touch`) fixes it.
- Known: if a paid handler errors after payment, the agent may still have paid (existing behaviour, not fixed).

### First live run (2026-11-11, $0.17 total)
Scanned `food2.jpeg` for `thyme-fig-tuvtmv` (17 items; cooked chicken expiring in ~2 days), 3 dinners, then shops near Herne Hill (Seasons of England, Dough Bakehouse, Fruit Garden, Naked Larder). Feedback: output works but is **three walls of text, not a wow moment**; payments are invisible apart from "tx 0x…"; online results were poor (only a US salad box).

### Ideas agreed but not built (in priority order)
1. ~~Drag-in photo + built-in demo image~~ (done, not yet committed; needs one live test after reconnecting MCP).
2. ~~**"Wow" output:**~~ (done, see above) one MCP tool `fridge_to_dinner` (scan → dinner → shops in one call) that returns a short summary plus a link to a page `/h/<id>/tonight`: "use it tonight" banner, one hero recipe card with the scanned photo, a walking-route map of shops with what to buy at each, and a receipts panel with the 3 MPP payments linked to the Tempo explorer.
3. Stripe card as a second payment method (optional for the hackathon, see above).
4. "Plan my week" (`/api/agent/week`), specified in `PLAN.md`: **awaiting the user's review, do not build yet.**
5. Minor polish: the scanner sometimes duplicates the unit ("tub tub container dip").

### Demo script (~90 s)
1. "Every family asks what's for dinner, then buys food they already have."
2. Drag a fridge photo into Claude Code (or say "scan my fridge" to use the built-in photo).
3. "…for thyme-fig-tuvtmv, what's for dinner, find the missing bits near Herne Hill."
4. Show the scan → dinners → local shops, and the "💳 session total $0.17" line.
5. Open the household link to show the family app updated.
6. "No API key, no checkout: the agent paid Stockpot per call over MPP."

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
