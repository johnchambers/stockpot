"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Pin } from "./map";

const ShopMap = dynamic(() => import("./map"), { ssr: false, loading: () => <div className="shimmer h-64 rounded-2xl" /> });

type Recipe = {
  title: string;
  minutes?: number;
  why?: string;
  uses?: { name: string; location?: string; expiring?: boolean }[];
  missing?: string[];
  steps?: string[];
};
type Line = {
  item: string;
  local: { store: string; address?: string | null; note: string; url: string } | null;
  online: { title: string; store: string; price: number | null; url: string } | null;
};
type Dinner = {
  id: string;
  recipe: Recipe;
  scan_id: string | null;
  place: string | null;
  basket: { lines: Line[]; summary?: string; pins?: Pin[] } | null;
  receipts: { route: string; amount: string; reference?: string | null }[];
  has_dish: boolean;
  created_at: string;
};

const EXPLORER = "https://explore.testnet.tempo.xyz/tx/";
const ROUTE_LABEL: Record<string, string> = {
  "/api/agent/scan": "Scanned your fridge",
  "/api/agent/recipes": "Planned 3 dinners",
  "/api/agent/shop": "Found local shops",
  "/api/agent/dish": "Plated tonight's dish",
};

export default function Tonight() {
  const { id: household } = useParams<{ id: string }>();
  const d = useSearchParams().get("d");
  const [dinner, setDinner] = useState<Dinner | null>(null);
  const [missing, setMissing] = useState(false);

  // Poll until the shops and receipts arrive (the agent attaches them after the dish photo).
  useEffect(() => {
    let stop = false;
    let tries = 0;
    async function load() {
      const r = await fetch(`/api/tonight?h=${encodeURIComponent(household)}${d ? `&d=${encodeURIComponent(d)}` : ""}`);
      if (stop) return;
      if (!r.ok) return setMissing(true);
      const { dinner } = (await r.json()) as { dinner: Dinner };
      setDinner(dinner);
      // Receipts are attached last, together with the basket, so they mark the page as complete.
      if (!dinner.receipts.length && ++tries < 40) setTimeout(load, 3000);
    }
    load();
    return () => {
      stop = true;
    };
  }, [household, d]);

  if (missing)
    return (
      <Shell household={household}>
        <p className="py-16 text-center text-muted">No dinner planned yet. Ask Claude “what’s for dinner?” and it’ll appear here.</p>
      </Shell>
    );
  if (!dinner)
    return (
      <Shell household={household}>
        <div className="shimmer aspect-[4/3] rounded-3xl" />
        <div className="shimmer mt-6 h-10 w-3/4 rounded-xl" />
      </Shell>
    );

  const r = dinner.recipe;
  const rescued = (r.uses ?? []).filter((u) => u.expiring);
  const img = (kind: "dish" | "scan", id: string) => `/api/img?h=${household}&kind=${kind}&id=${id}`;
  const shops = groupByShop(dinner.basket?.lines ?? []);
  const total = dinner.receipts.reduce((s, x) => s + Number(x.amount || 0), 0);

  return (
    <Shell household={household}>
      {dinner.has_dish && (
        <Reveal
          before={dinner.scan_id ? img("scan", dinner.scan_id) : null}
          after={img("dish", dinner.id)}
          title={r.title}
        />
      )}

      <section className="rise mt-6" style={{ animationDelay: "120ms" }}>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-tomato">Tonight{r.minutes ? ` · ${r.minutes} min` : ""}</p>
        <h1 className="mt-1 font-display text-4xl font-semibold leading-[1.05] tracking-tight text-balance">{r.title}</h1>
        {r.why && <p className="mt-3 text-muted">{r.why}</p>}
      </section>

      {rescued.length > 0 && (
        <section className="rise mt-6 rounded-2xl bg-ink p-4 text-cream" style={{ animationDelay: "220ms" }}>
          <p className="text-sm font-semibold">⏰ Rescued before they go off</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {rescued.map((u) => (
              <span key={u.name} className="rounded-full bg-cream/15 px-3 py-1 text-sm">
                {u.name}
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="rise mt-6 grid gap-6 sm:grid-cols-2" style={{ animationDelay: "320ms" }}>
        <div>
          <h2 className="font-display text-xl font-semibold">From your kitchen</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {(r.uses ?? []).map((u) => (
              <li key={u.name} className="flex items-center gap-2">
                <span className="text-herb">✓</span> {u.name}
                {u.location && <span className="text-xs text-muted">{u.location}</span>}
              </li>
            ))}
          </ul>
        </div>
        {(r.missing?.length ?? 0) > 0 && (
          <div>
            <h2 className="font-display text-xl font-semibold">To pick up</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {r.missing!.map((m) => (
                <li key={m} className="flex items-center gap-2">
                  <span className="text-tomato">+</span> {m}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {(r.steps?.length ?? 0) > 0 && (
        <section className="rise mt-8" style={{ animationDelay: "420ms" }}>
          <h2 className="font-display text-xl font-semibold">Method</h2>
          <ol className="mt-3 space-y-3">
            {r.steps!.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-butter text-sm font-semibold">{i + 1}</span>
                <span className="pt-0.5">{s}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="rise mt-10" style={{ animationDelay: "520ms" }}>
        <h2 className="font-display text-xl font-semibold">
          {r.missing?.length ? `Pick up the rest${dinner.place ? ` near ${dinner.place.split(",")[0]}` : ""}` : "Nothing to buy"}
        </h2>
        {!r.missing?.length ? (
          <p className="mt-2 text-muted">Everything for tonight is already in your kitchen. 🎉</p>
        ) : !dinner.basket && dinner.receipts.length ? (
          <p className="mt-2 text-sm text-muted">No shop search this time.</p>
        ) : !dinner.basket ? (
          <div className="mt-3 space-y-2">
            <p className="text-sm text-muted">Your agent is finding local shops…</p>
            <div className="shimmer h-64 rounded-2xl" />
          </div>
        ) : (
          <>
            {dinner.basket.pins && dinner.basket.pins.length > 1 && (
              <div className="mt-3">
                <ShopMap pins={dinner.basket.pins} />
                {walkingRoute(dinner.place, shops) && (
                  <a href={walkingRoute(dinner.place, shops)!} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-medium text-tomato">
                    🚶 Open walking route →
                  </a>
                )}
              </div>
            )}
            <ol className="mt-4 space-y-3">
              {shops.map((s, i) => (
                <li key={s.store} className="rounded-2xl border border-line bg-paper p-4">
                  <div className="flex items-start gap-3">
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-tomato text-sm font-semibold text-cream">{i + 1}</span>
                    <div className="min-w-0">
                      <a href={s.url} target="_blank" rel="noreferrer" className="font-semibold hover:underline">
                        {s.store}
                      </a>
                      {s.address && <p className="text-xs text-muted">{s.address}</p>}
                      <p className="mt-1 text-sm">
                        <span className="font-medium">Get:</span> {s.items.join(", ")}
                      </p>
                      <p className="mt-1 text-xs text-muted">{s.note}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>

      <section className="rise mt-10 rounded-2xl border border-dashed border-line p-4" style={{ animationDelay: "620ms" }}>
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-lg font-semibold">Your agent paid for this</h2>
          {total > 0 && <span className="font-mono text-sm">${total.toFixed(2)}</span>}
        </div>
        {dinner.receipts.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Receipts will appear here.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line text-sm">
            {dinner.receipts.map((x, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2">
                <span>{ROUTE_LABEL[x.route] ?? x.route}</span>
                <span className="flex items-center gap-3 font-mono text-xs">
                  {x.reference && (
                    <a href={EXPLORER + x.reference} target="_blank" rel="noreferrer" className="text-tomato hover:underline">
                      {x.reference.slice(0, 8)}…
                    </a>
                  )}
                  ${Number(x.amount).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted">Paid per request over the Machine Payments Protocol on Tempo testnet. No API key, no checkout.</p>
      </section>
    </Shell>
  );
}

function Shell({ household, children }: { household: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto min-h-dvh max-w-2xl px-4 pb-16 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <header className="mb-5 flex items-center justify-between">
        <Link href={`/h/${household}`} className="font-display text-2xl font-semibold tracking-tight">
          Stock<span className="text-tomato">pot</span>
        </Link>
        <Link href={`/h/${household}`} className="rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-cream">
          Our kitchen →
        </Link>
      </header>
      {children}
    </div>
  );
}

/** Before/after: drag between the fridge photo and the dish. Plays a reveal once both images load. */
function Reveal({ before, after, title }: { before: string | null; after: string; title: string }) {
  const [pos, setPos] = useState(before ? 100 : 0); // % of the width still showing the fridge
  const [loaded, setLoaded] = useState(0);
  const touched = useRef(false);

  useEffect(() => {
    if (!before || loaded < 2 || touched.current) return;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start - 500) / 1600);
      if (k > 0) setPos(100 - 55 * (1 - Math.pow(1 - k, 3)));
      if (k < 1 && !touched.current) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [before, loaded]);

  return (
    <div className="rise relative aspect-[4/3] overflow-hidden rounded-3xl bg-line shadow-[0_20px_50px_-20px_rgba(43,33,24,.5)]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={after} alt={title} onLoad={() => setLoaded((n) => n + 1)} className="absolute inset-0 size-full object-cover" />
      {before && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={before}
            alt="Your fridge"
            onLoad={() => setLoaded((n) => n + 1)}
            className="absolute inset-0 size-full object-cover"
            style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
          />
          <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-cream shadow" style={{ left: `${pos}%` }}>
            <div className="absolute top-1/2 left-1/2 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-cream text-ink shadow-lg">⇆</div>
          </div>
          <span className="absolute top-3 left-3 rounded-full bg-ink/70 px-2.5 py-1 text-xs font-medium text-cream" style={{ opacity: pos > 12 ? 1 : 0 }}>
            Your fridge
          </span>
          <span className="absolute top-3 right-3 rounded-full bg-tomato px-2.5 py-1 text-xs font-medium text-cream" style={{ opacity: pos < 88 ? 1 : 0 }}>
            Tonight
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={pos}
            aria-label="Compare your fridge with tonight's dinner"
            onChange={(e) => {
              touched.current = true;
              setPos(Number(e.target.value));
            }}
            className="absolute inset-0 size-full cursor-ew-resize opacity-0"
          />
        </>
      )}
    </div>
  );
}

type Shop = { store: string; address: string | null; url: string; note: string; items: string[] };

function groupByShop(lines: Line[]): Shop[] {
  const by = new Map<string, Shop>();
  for (const l of lines) {
    if (!l.local) continue;
    const s = by.get(l.local.store) ?? { store: l.local.store, address: l.local.address ?? null, url: l.local.url, note: l.local.note, items: [] };
    s.items.push(l.item);
    by.set(l.local.store, s);
  }
  return [...by.values()];
}

/** Google Maps walking directions from your area through each shop (no API key needed). */
function walkingRoute(place: string | null, shops: Shop[]): string | null {
  const stops = shops.map((s) => s.address ?? `${s.store}${place ? `, ${place}` : ""}`);
  if (!place || stops.length === 0) return null;
  const q = new URLSearchParams({ api: "1", origin: place, destination: stops[stops.length - 1], travelmode: "walking" });
  if (stops.length > 1) q.set("waypoints", stops.slice(0, -1).join("|"));
  return `https://www.google.com/maps/dir/?${q}`;
}
