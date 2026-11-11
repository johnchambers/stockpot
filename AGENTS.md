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
- Discovery: `/openapi.json` (x-payment-info per route), `/llms.txt`. `npx mppx validate https://stockpot-ten.vercel.app` → 79 passed, 0 failed (with bodies, before `/dish`); 2026-11-11 after deploying `/dish`: 100 passed, 0 failed (4 warnings + 4 skips only because it was run without `--body` and `--network testnet`).

### Hackathon status (checked 2026-11-11)
- ✅ Must: public, accepts payment, returns result + receipt. Live 402 has `WWW-Authenticate: Payment`.
- ✅ `/openapi.json`, `/llms.txt`, `mppx validate`, MCP tools (optional item).
- ⚠️ Not confirmed whether it has been submitted on the hackathon Submit page yet.
- ❌ Optional: real payment (Stripe card via Shared Payment Token, or Tempo mainnet) and "more than one way to pay". The site says "then switch to a real payment" but it is not in the Must or submission lists. **Decision: submit on testnet; add a Stripe card method only if there is time.**

### Claude chat interface (MCP)
- `mcp/stockpot-mcp.mjs`, registered in `.mcp.json` as `stockpot`. Tools: `fridge_to_dinner` (the headline, all-in-one), `family`, `scan_kitchen`, `whats_for_dinner`, `find_groceries`, `pantry_status`. Pays through the `mppx` CLI with keychain wallet `stockpot-agent` (no private key in process). Prints a "💳 Paid $x · session total" line.
- **Demo input = drag the photo into the terminal.** `scan_kitchen` cleans dragged paths (quotes, `\ ` escapes, `file://`, `~`). If `image` is omitted it scans the built-in demo photo `mcp/demo-fridge.jpeg` (copied from `~/Desktop/food2.jpeg`; source unknown, swap for an own photo before showing publicly). `location` defaults to `fridge`. Missing file → clear error, no charge. If an image is attached without a visible path, ask for the path rather than silently using the demo photo.
- After editing the MCP server, reconnect it (`/mcp` → stockpot) or restart Claude Code; the running process keeps the old code.
- MCP tools can't receive an image dropped into chat as pixels; they need a path or https URL.
- **Other chat clients:** the server is stdio-only (`StdioServerTransport`) and pays from the local keychain wallet, so it works in Claude Code and **Claude Desktop on this Mac**, but **not in claude.ai web or ChatGPT** (both need a hosted HTTPS MCP endpoint). Making it work there = host an MCP endpoint on the Vercel app (e.g. `/mcp`) **and** decide how the hosted server pays (server-side wallet, family Stripe account or credits, or free for the demo). Not built.
- **Claude Desktop config written 2026-11-11** at `~/Library/Application Support/Claude/claude_desktop_config.json` (absolute paths: `/opt/homebrew/bin/node` + this repo's `mcp/stockpot-mcp.mjs`, same env as `.mcp.json`). Claude Desktop was **not installed yet**; the app reads the file on first launch. In Desktop, attached photos don't give a path, so the user has to type the path or use `use_pantry`. Checked again after the deploy (commit `0eef1a9`): the config is correct and needs no change, and it shares `~/.stockpot/config.json` with Claude Code, so a family connected in one is connected in both. Claude Desktop is still not installed in /Applications.

### Family setup, pairing and the "tonight" page (built 2026-11-11, commit `0eef1a9`, deployed to production)
- MCP remembers the connected family in `~/.stockpot/config.json` (override path with `STOCKPOT_CONFIG`). No family → tools return instructions to ask "Do you already have a Stockpot family?" → `family` tool: `create` | `join` (code or share link) | `status` | `forget`.
- Family app header: "Connect Claude" button shows a one-time code (6 chars, 10 min, `pair_codes` table) and a "Tonight's dinner" link.
- `fridge_to_dinner` MCP tool: scan → recipes (picks the one rescuing most expiring food) → dish photo + shops in parallel → PATCH dinner → opens `/h/<id>/tonight?d=<id>` in the browser (`STOCKPOT_OPEN_BROWSER=0` disables). ~40s, ~$0.20.
- Tonight page (`src/app/h/[id]/tonight/`): animated before/after slider (fridge scan → dish), rescued items, method, Leaflet map (CARTO tiles) with numbered shop pins + Google Maps walking-route link, receipts linked to `explore.testnet.tempo.xyz`.
- New tables: `dinners`, `pair_codes`, `pair_attempts`. Images served from `/api/img?h=&kind=dish|scan&id=`.
- Dev gotcha: Turbopack sometimes keeps a stale copy of `src/lib/stockpot.ts` in route bundles; a real content edit (not `touch`) fixes it.
- Known: if a paid handler errors after payment, the agent may still have paid (existing behaviour, not fixed).
- Tested end to end locally (42 s, $0.15, test family `lemon-lemon-rdt8bu`, left in the shared Turso DB). Production smoke test after deploy: `/dish` returns 402, tonight page 200, pairing code issued.
- With the demo photo, the best-scoring dinner can need nothing from the shops, so there is no map. For the demo, add a constraint like "something warm and cooked" to get a few missing items.
- **Deploying:** pushing to GitHub does NOT deploy. Deploy with the Vercel CLI and the token from `.env`: `vercel deploy --prod -y --token "$VERCEL_TOKEN" --scope "$VERCEL_TEAM_ID"`. Turso is shared by local dev and production.

### First live run (2026-11-11, $0.17 total)
Scanned `food2.jpeg` for `thyme-fig-tuvtmv` (17 items; cooked chicken expiring in ~2 days), 3 dinners, then shops near Herne Hill (Seasons of England, Dough Bakehouse, Fruit Garden, Naked Larder). Feedback: output works but is **three walls of text, not a wow moment**; payments are invisible apart from "tx 0x…"; online results were poor (only a US salad box).

### Second live session (2026-11-11, user acting as a real family)
- **Worked end to end:** dragged-in photo paths (Desktop file and a macOS screenshot under `/var/folders/...` with spaces) scanned fine; freezer, fridge and a crowded US fridge all gave 18–19 items. `whats_for_dinner` handles free-text constraints well ("kid-friendly", "feast for 8–10, extra shopping under €20", "student budget, batch-cook"). Fresh-install flow worked: scan → "no family" → user said no → `family create` → `lemon-clove-kkb97x`; the user's app then showed pairing code `RQ9-SXS`, which `join` resolved to the same family.
- **What users asked for beyond the tools** (Claude filled the gaps by hand): a combined multi-course feast menu, a costed shopping list against a budget, a minute-by-minute one-oven cooking timeline, a printable tick-box checklist (published as a claude.ai Artifact), and a **7-day student meal plan** (more demand for idea 4 below).
- **`find_groceries` weaknesses:** it only searches *independent* shops, so for budget lists it suggests specialty or impractical places (cheesemonger for grated cheddar, a trade-only bakery, a warehouse in another town, a farm shop closed that day, a soft-serve shop for "ice cream"). Online matches were mostly missing or absurd (2kg catering cheddar). It also mislabelled a 2kg online price as `$` while assuming EUR. Ideas: a "budget / one-stop" mode that allows supermarkets, filter out trade-only shops, check opening hours against today, and handle currency per country. Eircodes (e.g. `D24Y7KH`) and "Knocklyon, Dublin 16" both worked as `place`.
- **Scanner nits:** vague names ("condiment bottle", "snack bag", "leftovers") and some guesses from packaging (dips, sauces). Tell the user to check them.
- **Other MPP services tried from the same wallet:** payforgoals.com (`/api/v1/scores/match/1` → 402, $1.00, offers Tempo testnet chain 42431 *and* a Stripe test card method; callable with `npx mppx <url> -a stockpot-agent --network testnet`, not run). A localtunnel URL was down (503), and an AWS ECS Express service only exposed `/health`, with no discovery files. Pattern: curl first, read the 402 challenge, tell the user the price, and ask before paying a third party.

### Ideas agreed but not built (in priority order)
1. ~~Drag-in photo + built-in demo image~~ (done, live-tested and deployed 2026-11-11).
2. ~~**"Wow" output:**~~ (done and deployed, see above) one MCP tool `fridge_to_dinner` (scan → dinner → shops in one call) that returns a short summary plus a link to a page `/h/<id>/tonight`: "use it tonight" banner, one hero recipe card with the scanned photo, a walking-route map of shops with what to buy at each, and a receipts panel with the 3 MPP payments linked to the Tempo explorer.
3. Stripe card as a second payment method (optional for the hackathon, see above).
4. "Plan my week" (`/api/agent/week`), specified in `PLAN.md`: **awaiting the user's review, do not build yet.** (A user asked for exactly this on 2026-11-11, a student week plan.)
5. Minor polish: the scanner sometimes duplicates the unit ("tub tub container dip").
6. `find_groceries` budget / one-stop mode (see second live session). Suggested, not agreed.
7. Hosted MCP endpoint so Stockpot works in claude.ai web and ChatGPT (needs a payment decision first). Suggested, not agreed.

### Demo script (~90 s)
1. "Every family asks what's for dinner, then buys food they already have."
2. Beforehand: connect the family once (`family` → join with the "Connect Claude" code), or show the "do you have a family?" flow live.
3. Drag a fridge photo into Claude Code: "What's for dinner? Something warm and cooked, I'm near Herne Hill." → `fridge_to_dinner`.
4. ~40 s later the browser opens the tonight page: the fridge photo wipes into the AI dish photo, then rescued items, method, shop map with walking route.
5. Scroll to "Your agent paid for this": 3–4 MPP payments (~$0.20), each linked to the Tempo explorer.
6. "No API key, no checkout: the agent paid Stockpot per call over MPP."

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
