#!/usr/bin/env node
/**
 * Stockpot MCP server: lets Claude (or any MCP client) use Stockpot from chat and pay per call with MPP.
 *
 * Payments go through the `mppx` CLI using a keychain wallet (default: `stockpot-agent`), so no private key
 * ever touches this process. Tempo testnet.
 *
 *   claude mcp add stockpot -- node /abs/path/mcp/stockpot-mcp.mjs
 *
 * Env: STOCKPOT_URL (default https://stockpot-ten.vercel.app), MPPX_ACCOUNT (default stockpot-agent),
 *      STOCKPOT_HOUSEHOLD (optional default family household id), STOCKPOT_OPEN_BROWSER=0 to never open pages.
 *
 * The connected family is remembered in ~/.stockpot/config.json, so new chat sessions pick it up.
 */
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const run = promisify(execFile);
const BASE = (process.env.STOCKPOT_URL ?? "https://stockpot-ten.vercel.app").replace(/\/$/, "");
const ACCOUNT = process.env.MPPX_ACCOUNT ?? "stockpot-agent";
const MPPX = join(import.meta.dirname, "..", "node_modules", ".bin", "mppx");
const PRICES = { "/api/agent/scan": "0.05", "/api/agent/recipes": "0.02", "/api/agent/shop": "0.10", "/api/agent/dish": "0.03" };
const OPEN_BROWSER = process.env.STOCKPOT_OPEN_BROWSER !== "0";

/* ---------- The connected family, remembered across chat sessions ---------- */

const CONFIG = process.env.STOCKPOT_CONFIG ?? join(homedir(), ".stockpot", "config.json");
const isHousehold = (h) => typeof h === "string" && /^[a-z0-9-]{8,48}$/.test(h);

async function savedHousehold() {
  try {
    const { household } = JSON.parse(await readFile(CONFIG, "utf8"));
    return isHousehold(household) ? household : null;
  } catch {
    return null;
  }
}

async function rememberHousehold(household) {
  await mkdir(dirname(CONFIG), { recursive: true });
  await writeFile(CONFIG, JSON.stringify({ household, saved_at: new Date().toISOString() }, null, 2));
}

/** Explicit arg → env → saved config. An explicit household is remembered if none is saved yet. */
async function resolveHousehold(arg) {
  const saved = await savedHousehold();
  if (isHousehold(arg)) {
    if (!saved) await rememberHousehold(arg).catch(() => {});
    return arg;
  }
  return process.env.STOCKPOT_HOUSEHOLD || saved;
}

const NO_FAMILY =
  "No Stockpot family is connected on this computer yet, so nothing was charged.\n" +
  "Ask the user: \"Do you already have a Stockpot family kitchen?\"\n" +
  "- No → call `family` with action \"create\".\n" +
  "- Yes → ask them to tap \"Connect Claude\" in their Stockpot app and tell you the 6-character code, then call `family` with action \"join\" and that code. (Pasting their /h/<id> share link also works.)\n" +
  "Then retry this request.";

const WORDS = ["basil", "thyme", "mango", "olive", "pepper", "lemon", "clove", "ginger", "fig", "sage", "plum", "kale"];
function newHouseholdId() {
  const r = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)));
  const [a, b] = r(2).map((x) => WORDS[x % WORDS.length]);
  return `${a}-${b}-${r(6).map((x) => "abcdefghjkmnpqrstuvwxyz23456789"[x % 31]).join("")}`;
}

/** Open a page in the user's browser (macOS `open`, else xdg-open / start). Best-effort. */
function openInBrowser(url) {
  if (!OPEN_BROWSER) return false;
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  run(cmd, args).catch(() => {});
  return true;
}

let spent = 0;

/** POST to a paid Stockpot endpoint; mppx handles 402 → pay → retry. Returns parsed body + receipt. */
async function paidPost(path, body) {
  const { stdout } = await run(
    MPPX,
    [`${BASE}${path}`, "-a", ACCOUNT, "--network", "testnet", "-i", "-J", JSON.stringify(body)],
    { maxBuffer: 20 * 1024 * 1024, timeout: 180_000 },
  ).catch((e) => ({ stdout: e.stdout ?? "", stderr: e.stderr ?? String(e) }));

  // With -i, output is one or more "headers\r\n\r\nbody" blocks (402 then 200); take the last.
  const blocks = stdout.split(/\r?\n(?=HTTP\/)/);
  const last = blocks[blocks.length - 1];
  const [head, ...rest] = last.split(/\r?\n\r?\n/);
  const status = Number(head.match(/^HTTP\/[\d.]+ (\d+)/)?.[1] ?? 0);
  const receiptB64 = head.match(/^payment-receipt:\s*(.+)$/im)?.[1]?.trim();
  let receipt = null;
  if (receiptB64) {
    try {
      receipt = JSON.parse(Buffer.from(receiptB64, "base64url").toString("utf8"));
    } catch {}
  }
  let data;
  try {
    data = JSON.parse(rest.join("\n\n"));
  } catch {
    data = { error: rest.join("\n\n").slice(0, 500) || `Request failed (status ${status || "unknown"})` };
  }
  if (status === 200) spent += Number(PRICES[path] ?? 0);
  return { status, data, receipt };
}

function paymentNote(path, receipt, status) {
  if (status !== 200) return `\n\n(No charge: request failed with status ${status}.)`;
  const ref = receipt?.reference ? ` · tx ${receipt.reference.slice(0, 10)}…` : "";
  return `\n\n💳 Paid $${PRICES[path]} via MPP on Tempo testnet${ref} · session total $${spent.toFixed(2)}`;
}

const text = (s) => ({ content: [{ type: "text", text: s }] });

/** Built-in fridge photo, used when no image is given (so the demo always works). */
const DEMO_IMAGE = join(import.meta.dirname, "demo-fridge.jpeg");

/**
 * Clean up a path dragged into a terminal: strip surrounding quotes, `file://`, backslash escapes
 * ("My\ Photo.jpg"), and expand `~`.
 */
function cleanPath(raw) {
  let p = raw.trim().replace(/^(['"])(.*)\1$/, "$2");
  if (p.startsWith("file://")) p = decodeURIComponent(p.slice(7));
  p = p.replace(/\\(.)/g, "$1");
  if (p === "~" || p.startsWith("~/")) p = join(homedir(), p.slice(1));
  return p;
}

/** Local image → ≤1024px JPEG data URL (macOS `sips`), or pass https URLs through. */
async function toImage(pathOrUrl) {
  if (/^https:\/\//.test(pathOrUrl) || pathOrUrl.startsWith("data:image/")) return pathOrUrl;
  const src = cleanPath(pathOrUrl);
  try {
    await access(src);
  } catch {
    throw new Error(`No file at ${src}. Drag the photo into the terminal again, or leave the image out to use the built-in demo fridge.`);
  }
  const dir = await mkdtemp(join(tmpdir(), "stockpot-"));
  try {
    const out = join(dir, "img.jpg");
    await run("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "75", "-Z", "1024", src, "--out", out]).catch(() => {
      throw new Error(`Couldn't read ${src} as an image (try a JPEG, PNG or HEIC).`);
    });
    return `data:image/jpeg;base64,${(await readFile(out)).toString("base64")}`;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const server = new McpServer({ name: "stockpot", version: "1.1.0" });
const household = z
  .string()
  .optional()
  .describe("Family household id (from a /h/<id> share link). Omit to use the family connected on this computer.");
const IMAGE_HELP =
  "If the user dragged a photo into the terminal, pass the file path exactly as it appears in their message (quotes, backslash escapes and ~ are fine). " +
  "If the user has no photo, omit `image` to use the built-in demo fridge photo (say that you used the demo photo). " +
  "If they attached an image but no file path is visible, ask for the path rather than silently using the demo photo.";
const imageArg = z.string().optional().describe("Local image path (as dragged into the terminal) or https image URL. Omit to use the built-in demo fridge photo.");
const locationArg = z.enum(["fridge", "freezer", "pantry", "cupboard", "spices"]).default("fridge");

/** Load the photo (or the demo one). Returns { dataUrl } or { error }. */
async function loadPhoto(image) {
  try {
    return { dataUrl: await toImage(image?.trim() ? image : DEMO_IMAGE), demo: !image?.trim() };
  } catch (e) {
    return { error: `${e.message}\n\n(No charge: the photo wasn't sent.)` };
  }
}

server.registerTool(
  "family",
  {
    title: "Stockpot family kitchen",
    description:
      "Connect this computer to a Stockpot family kitchen (free). The connection is remembered for future chats. " +
      "Use when another Stockpot tool says no family is connected: first ASK the user whether they already have a Stockpot family. " +
      "action 'create' makes a new family; 'join' connects to an existing one using the 6-character code from 'Connect Claude' in their Stockpot app (or their /h/<id> share link); " +
      "'status' shows which family is connected; 'forget' disconnects.",
    inputSchema: {
      action: z.enum(["status", "create", "join", "forget"]),
      code: z.string().optional().describe("For 'join': the code from the app, e.g. 'FGK-482', or a share link / household id"),
    },
  },
  async ({ action, code }) => {
    const current = await resolveHousehold();
    if (action === "status") {
      return text(current ? `Connected to family kitchen ${current}: ${BASE}/h/${current}` : NO_FAMILY.replace(", so nothing was charged", ""));
    }
    if (action === "forget") {
      await rm(CONFIG, { force: true });
      return text("Disconnected. The family's kitchen is unchanged; join again with a new code from the app.");
    }
    if (action === "create") {
      const h = newHouseholdId();
      await rememberHousehold(h);
      const note = current ? `\n(Previously connected to ${current}; that kitchen is unchanged.)` : "";
      return text(
        `Created a new Stockpot family kitchen and connected this computer to it.\n` +
          `Family link (share it so others can join, or open it on your phone): ${BASE}/h/${h}${note}\n` +
          `Next: scan the fridge, or ask what's for dinner.`,
      );
    }
    // join
    const raw = (code ?? "").trim();
    if (!raw) return text("Ask the user for the code shown under \"Connect Claude\" in their Stockpot app (or their family share link).");
    const linked = raw.match(/\/h\/([a-z0-9-]{8,48})/)?.[1] ?? (isHousehold(raw) && raw.includes("-") && raw.length > 7 ? raw : null);
    let h = linked;
    if (!h) {
      const r = await fetch(`${BASE}/api/agent/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: raw }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return text(`Couldn't connect: ${d.error ?? `error ${r.status}`}`);
      h = d.household;
    }
    await rememberHousehold(h);
    const items = await fetch(`${BASE}/api/agent/pantry?household=${h}`).then((r) => r.json()).catch(() => null);
    const n = items?.items?.filter((i) => i.status !== "out").length;
    return text(`Connected to your family kitchen${n != null ? ` (${n} items in it right now)` : ""}: ${BASE}/h/${h}\nThis computer will remember it for future chats.`);
  },
);

server.registerTool(
  "fridge_to_dinner",
  {
    title: "Fridge to dinner",
    description:
      "The full Stockpot experience in one step: scan a fridge photo, pick tonight's dinner (using what expires first), " +
      "generate a photo of the finished dish, find the missing ingredients at local shops, and open a beautiful 'tonight' page in the browser " +
      "(before/after photo, recipe, shop map, payment receipts). Prefer this over calling the separate tools when the user wants dinner sorted. " +
      "Costs about $0.20 via MPP ($0.05 scan + $0.02 recipes + $0.03 dish photo + $0.10 shops). Takes ~40–60 seconds. " +
      IMAGE_HELP,
    inputSchema: {
      image: imageArg,
      location: locationArg,
      place: z.string().optional().describe("Where to shop: neighbourhood, town or postcode, e.g. 'Herne Hill, London'. Ask if unknown; omit to skip shopping."),
      constraints: z.string().optional().describe("e.g. '30 min, vegetarian, kid-friendly'"),
      use_pantry: z.boolean().optional().describe("true = skip the scan and plan from the family's existing pantry"),
      household,
    },
  },
  async ({ image, location, place, constraints, use_pantry, household: h }) => {
    const hh = await resolveHousehold(h);
    if (!hh) return text(NO_FAMILY);
    const receipts = [];
    const log = [];
    const pay = (route, receipt) => receipts.push({ route, amount: PRICES[route], reference: receipt?.reference ?? null });

    // 1. Scan
    let photoNote = "";
    if (!use_pantry) {
      const photo = await loadPhoto(image);
      if (photo.error) return text(photo.error);
      const s = await paidPost("/api/agent/scan", { image: photo.dataUrl, location, household: hh });
      if (s.status !== 200) return text(`Scan failed: ${s.data.error ?? s.status}${paymentNote("/api/agent/scan", s.receipt, s.status)}`);
      pay("/api/agent/scan", s.receipt);
      photoNote = photo.demo ? " (built-in demo photo)" : "";
      log.push(`📸 Scanned the ${location}${photoNote}: ${s.data.items.length} items.`);
    }

    // 2. Recipes → pick the one that rescues the most expiring food
    const rr = await paidPost("/api/agent/recipes", { household: hh, constraints });
    if (rr.status !== 200) return text(`${log.join("\n")}\nCouldn't plan dinner: ${rr.data.error ?? rr.status}`);
    pay("/api/agent/recipes", rr.receipt);
    const recipes = rr.data.recipes;
    const score = (r) => r.uses.filter((u) => u.expiring).length * 2 - r.missing.length;
    const best = recipes.reduce((a, b) => (score(b) > score(a) ? b : a));

    // 3. Dish photo + tonight page, and shops for the missing bits, in parallel
    const [dish, shop] = await Promise.all([
      paidPost("/api/agent/dish", { household: hh, recipe: best, place }),
      place && best.missing.length ? paidPost("/api/agent/shop", { items: best.missing.slice(0, 10), place }) : Promise.resolve(null),
    ]);
    if (dish.status === 200) pay("/api/agent/dish", dish.receipt);
    if (shop?.status === 200) pay("/api/agent/shop", shop.receipt);

    // 4. Attach shops + receipts to the page, then open it
    let url = null;
    if (dish.status === 200) {
      url = dish.data.url.replace(/^https?:\/\/[^/]+/, BASE);
      await fetch(`${BASE}/api/agent/dinner`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ household: hh, id: dish.data.id, place, basket: shop?.status === 200 ? shop.data : undefined, receipts }),
      }).catch(() => {});
    }
    const opened = url ? openInBrowser(url) : false;

    // 5. Chat summary
    const rescued = best.uses.filter((u) => u.expiring).map((u) => u.name);
    const others = recipes.filter((r) => r !== best).map((r) => r.title).join(" · ");
    const shops = shop?.status === 200
      ? [...new Set(shop.data.lines.filter((l) => l.local).map((l) => l.local.store))].map((st) => `${st} (${shop.data.lines.filter((l) => l.local?.store === st).map((l) => l.item).join(", ")})`).join("; ")
      : null;
    const total = receipts.reduce((s, r) => s + Number(r.amount), 0);
    const out = [
      ...log,
      `🍽️ Tonight: **${best.title}** (${best.minutes} min). ${best.why}`,
      rescued.length ? `⏰ Rescues: ${rescued.join(", ")}` : null,
      best.missing.length ? `🛒 Missing: ${best.missing.join(", ")}` : "🛒 Nothing to buy.",
      shops ? `📍 Shops near ${place}: ${shops}` : place ? null : "(No place given, so no shop search. Ask where they are to find the missing bits.)",
      `Also possible: ${others}`,
      dish.status !== 200 ? `(Dish photo failed: ${dish.data.error ?? dish.status}, so no page this time.)` : null,
      url ? `${opened ? "🌐 Opened in the browser: " : "🌐 Tonight page: "}${url}` : null,
      `💳 ${receipts.length} payments via MPP on Tempo testnet: $${total.toFixed(2)} · session total $${spent.toFixed(2)}`,
    ].filter(Boolean);
    return text(out.join("\n"));
  },
);

server.registerTool(
  "scan_kitchen",
  {
    title: "Scan kitchen photo",
    description:
      "Turn a photo of a fridge, freezer, pantry, cupboard or spice rack into a food inventory, synced to the family's app. Costs $0.05 (paid automatically via MPP). " +
      IMAGE_HELP,
    inputSchema: { image: imageArg, location: locationArg, household },
  },
  async ({ image, location, household: h }) => {
    const hh = await resolveHousehold(h);
    if (!hh) return text(NO_FAMILY);
    const path = "/api/agent/scan";
    const photo = await loadPhoto(image);
    if (photo.error) return text(photo.error);
    const { status, data, receipt } = await paidPost(path, { image: photo.dataUrl, location, household: hh });
    if (status !== 200) return text(`Scan failed: ${data.error ?? status}${paymentNote(path, receipt, status)}`);
    const source = photo.demo ? " (built-in demo photo)" : "";
    const list = data.items.map((i) => `- ${i.quantity} ${i.unit} ${i.name}${i.shelf_life_days != null ? ` (use within ~${i.shelf_life_days}d)` : ""}`).join("\n");
    const sync = data.household ? `\nSynced to the family kitchen: ${BASE}/h/${data.household}` : "";
    return text(`Found ${data.items.length} items in the ${location}${source}:\n${list}${sync}${paymentNote(path, receipt, status)}`);
  },
);

server.registerTool(
  "whats_for_dinner",
  {
    title: "What's for dinner",
    description:
      "Suggest 3 dinners using what's in the kitchen, prioritising food that expires soonest, and list missing ingredients. Costs $0.02 via MPP. " +
      "Uses the connected family's pantry, or an items list. For the full experience with a dish photo and shop map, use fridge_to_dinner.",
    inputSchema: {
      household,
      items: z.array(z.object({ name: z.string(), location: z.string().optional(), est_expiry: z.string().optional() })).optional(),
      constraints: z.string().optional().describe("e.g. '30 min, vegetarian, kid-friendly'"),
    },
  },
  async ({ household: h, items, constraints }) => {
    const path = "/api/agent/recipes";
    const hh = items?.length ? undefined : await resolveHousehold(h);
    if (!hh && !items?.length) return text(NO_FAMILY);
    const { status, data, receipt } = await paidPost(path, { household: hh, items, constraints });
    if (status !== 200) return text(`Couldn't plan dinner: ${data.error ?? status}${paymentNote(path, receipt, status)}`);
    const out = data.recipes
      .map((r, n) => `${n + 1}. **${r.title}** (${r.minutes} min): ${r.why}\n   Uses: ${r.uses.map((u) => (u.expiring ? `⏰${u.name}` : u.name)).join(", ")}\n   Missing: ${r.missing.join(", ") || "nothing"}\n   Steps: ${r.steps.join(" → ")}`)
      .join("\n\n");
    return text(out + paymentNote(path, receipt, status));
  },
);

server.registerTool(
  "find_groceries",
  {
    title: "Find groceries nearby",
    description: "Shopping agent: find missing grocery items at independent local shops near a place, plus online buy links. Costs $0.10 via MPP.",
    inputSchema: {
      items: z.array(z.string()).min(1).max(10),
      place: z.string().describe("Town, neighbourhood or ZIP"),
    },
  },
  async ({ items, place }) => {
    const path = "/api/agent/shop";
    const { status, data, receipt } = await paidPost(path, { items, place });
    if (status !== 200) return text(`Shopping failed: ${data.error ?? status}${paymentNote(path, receipt, status)}`);
    const out = data.lines
      .map((l) => `- **${l.item}**\n  📍 ${l.local ? `${l.local.store}${l.local.address ? `, ${l.local.address}` : ""}: ${l.local.note} (${l.local.url})` : "no local shop found"}\n  🛒 ${l.online ? `${l.online.title} at ${l.online.store}${l.online.price != null ? ` $${l.online.price}` : ""} (${l.online.url})` : "no good online match"}`)
      .join("\n");
    return text(`${data.summary}\n\n${out}${paymentNote(path, receipt, status)}`);
  },
);

server.registerTool(
  "pantry_status",
  {
    title: "Pantry status",
    description: "Free: list what the family currently has, grouped by location, with use-by dates.",
    inputSchema: { household },
  },
  async ({ household: h }) => {
    const hh = await resolveHousehold(h);
    if (!hh) return text(NO_FAMILY.replace(", so nothing was charged", ""));
    const r = await fetch(`${BASE}/api/agent/pantry?household=${encodeURIComponent(hh)}`);
    const d = await r.json();
    if (!r.ok) return text(d.error ?? `Error ${r.status}`);
    if (!d.items.length) return text("The pantry is empty. Scan the fridge or a cupboard first.");
    const by = {};
    for (const i of d.items.filter((i) => i.status !== "out")) (by[i.location] ??= []).push(`${i.name}${i.est_expiry ? ` (use by ${i.est_expiry})` : ""}${i.status === "low" ? " [low]" : ""}`);
    return text(Object.entries(by).map(([loc, xs]) => `**${loc}**: ${xs.join(", ")}`).join("\n") + `\n\nOpen in app: ${BASE}/h/${hh}`);
  },
);

await server.connect(new StdioServerTransport());
