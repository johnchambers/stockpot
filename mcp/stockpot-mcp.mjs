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
 *      STOCKPOT_HOUSEHOLD (optional default family household id).
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const run = promisify(execFile);
const BASE = (process.env.STOCKPOT_URL ?? "https://stockpot-ten.vercel.app").replace(/\/$/, "");
const ACCOUNT = process.env.MPPX_ACCOUNT ?? "stockpot-agent";
const DEFAULT_HOUSEHOLD = process.env.STOCKPOT_HOUSEHOLD;
const MPPX = join(import.meta.dirname, "..", "node_modules", ".bin", "mppx");
const PRICES = { "/api/agent/scan": "0.05", "/api/agent/recipes": "0.02", "/api/agent/shop": "0.10" };

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

/** Local image → ≤1024px JPEG data URL (macOS `sips`), or pass https URLs through. */
async function toImage(pathOrUrl) {
  if (/^https:\/\//.test(pathOrUrl) || pathOrUrl.startsWith("data:image/")) return pathOrUrl;
  const dir = await mkdtemp(join(tmpdir(), "stockpot-"));
  try {
    const out = join(dir, "img.jpg");
    await run("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "75", "-Z", "1024", pathOrUrl, "--out", out]);
    return `data:image/jpeg;base64,${(await readFile(out)).toString("base64")}`;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const server = new McpServer({ name: "stockpot", version: "1.0.0" });
const household = z.string().optional().describe("Family household id from a Stockpot share link (/h/<id>). Syncs results to the family's app.");

server.registerTool(
  "scan_kitchen",
  {
    title: "Scan kitchen photo",
    description: "Turn a photo of a fridge, freezer, pantry, cupboard or spice rack into a food inventory. Costs $0.05 (paid automatically via MPP).",
    inputSchema: {
      image: z.string().describe("Absolute path to a local image file, or an https image URL"),
      location: z.enum(["fridge", "freezer", "pantry", "cupboard", "spices"]),
      household,
    },
  },
  async ({ image, location, household: h }) => {
    const path = "/api/agent/scan";
    const { status, data, receipt } = await paidPost(path, { image: await toImage(image), location, household: h ?? DEFAULT_HOUSEHOLD });
    if (status !== 200) return text(`Scan failed: ${data.error ?? status}${paymentNote(path, receipt, status)}`);
    const list = data.items.map((i) => `- ${i.quantity} ${i.unit} ${i.name}${i.shelf_life_days != null ? ` (use within ~${i.shelf_life_days}d)` : ""}`).join("\n");
    const sync = data.household ? `\nSynced to household ${data.household}: ${BASE}/h/${data.household}` : "";
    return text(`Found ${data.items.length} items in the ${location}:\n${list}${sync}${paymentNote(path, receipt, status)}`);
  },
);

server.registerTool(
  "whats_for_dinner",
  {
    title: "What's for dinner",
    description: "Suggest 3 dinners using what's in the kitchen, prioritising food that expires soonest, and list missing ingredients. Costs $0.02 via MPP. Pass a household OR an items list.",
    inputSchema: {
      household,
      items: z.array(z.object({ name: z.string(), location: z.string().optional(), est_expiry: z.string().optional() })).optional(),
      constraints: z.string().optional().describe("e.g. '30 min, vegetarian, kid-friendly'"),
    },
  },
  async ({ household: h, items, constraints }) => {
    const path = "/api/agent/recipes";
    const hh = h ?? (items?.length ? undefined : DEFAULT_HOUSEHOLD);
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
      .map((l) => `- **${l.item}**\n  📍 ${l.local ? `${l.local.store}: ${l.local.note} (${l.local.url})` : "no local shop found"}\n  🛒 ${l.online ? `${l.online.title} at ${l.online.store}${l.online.price != null ? ` $${l.online.price}` : ""} (${l.online.url})` : "no good online match"}`)
      .join("\n");
    return text(`${data.summary}\n\n${out}${paymentNote(path, receipt, status)}`);
  },
);

server.registerTool(
  "pantry_status",
  {
    title: "Pantry status",
    description: "Free: list what a family currently has, grouped by location, with use-by dates.",
    inputSchema: { household },
  },
  async ({ household: h }) => {
    const hh = h ?? DEFAULT_HOUSEHOLD;
    if (!hh) return text("Which household? Pass the id from the family's Stockpot share link (/h/<id>).");
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
