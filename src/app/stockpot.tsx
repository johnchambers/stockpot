"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Location = "fridge" | "freezer" | "pantry" | "cupboard" | "spices";
type Item = {
  id: string;
  name: string;
  category: string | null;
  location: Location;
  quantity: number;
  unit: string | null;
  status: "have" | "low" | "out";
  est_expiry: string | null;
};
type Recipe = {
  title: string;
  minutes: number;
  why: string;
  uses: { name: string; location: string; expiring: boolean }[];
  missing: string[];
  steps: string[];
};
type Basket = {
  lines: {
    item: string;
    local: { store: string; note: string; url: string } | null;
    online: { title: string; store: string; price: number | null; url: string; image: string | null } | null;
  }[];
  summary: string;
  toolCalls: number;
};
type Tab = "scan" | "pantry" | "cook" | "shop";

const LOCATIONS: { id: Location; label: string; emoji: string }[] = [
  { id: "fridge", label: "Fridge", emoji: "🧊" },
  { id: "freezer", label: "Freezer", emoji: "❄️" },
  { id: "pantry", label: "Pantry", emoji: "🥫" },
  { id: "cupboard", label: "Cupboard", emoji: "🗄️" },
  { id: "spices", label: "Spices", emoji: "🧂" },
];

const daysUntil = (d: string | null) =>
  d == null ? null : Math.round((new Date(d).getTime() - new Date(new Date().toDateString()).getTime()) / 86_400_000);

async function resizeToDataUrl(file: File, max = 1024): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.8);
}

async function readJson(r: Response): Promise<{ error?: string } & Record<string, unknown>> {
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: `Server error (${r.status})` };
  }
}

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {}
}

export default function Stockpot() {
  const [tab, setTab] = useState<Tab>("scan");
  const [items, setItems] = useState<Item[]>([]);
  // Client-only component (see page.tsx), so localStorage is safe in initialisers.
  const [extras, setExtras] = useState<string[]>(() => load("sp-extras", [])); // shopping-list additions from recipes
  const [checked, setChecked] = useState<string[]>(() => load("sp-checked", []));

  const refresh = useCallback(async () => {
    const r = await fetch("/api/items");
    if (r.ok) setItems((await r.json()).items);
  }, []);

  useEffect(() => {
    fetch("/api/items")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setItems(d.items));
  }, []);
  useEffect(() => save("sp-extras", extras), [extras]);
  useEffect(() => save("sp-checked", checked), [checked]);

  const shoppingList = useMemo(() => {
    const fromInventory = items.filter((i) => i.status !== "have").map((i) => i.name);
    const have = new Set(items.filter((i) => i.status === "have").map((i) => i.name.toLowerCase()));
    return [...new Set([...fromInventory, ...extras.filter((e) => !have.has(e.toLowerCase()))])];
  }, [items, extras]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 pb-28 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <header className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="font-display text-4xl font-semibold tracking-tight">
            Stock<span className="text-tomato">pot</span>
          </h1>
          <p className="text-sm text-muted">Raid your own kitchen before you go shopping.</p>
        </div>
        <span className="rounded-full bg-paper px-3 py-1 text-xs text-muted ring-1 ring-line">
          {items.filter((i) => i.status !== "out").length} items
        </span>
      </header>

      {tab === "scan" && <ScanTab onSaved={(next) => { refresh(); if (next) setTab("pantry"); }} />}
      {tab === "pantry" && <PantryTab items={items} setItems={setItems} goScan={() => setTab("scan")} />}
      {tab === "cook" && (
        <CookTab
          hasItems={items.length > 0}
          addToList={(names) => { setExtras((e) => [...new Set([...e, ...names])]); setTab("shop"); }}
        />
      )}
      {tab === "shop" && (
        <ShopTab
          list={shoppingList}
          checked={checked}
          toggle={(n) => setChecked((c) => (c.includes(n) ? c.filter((x) => x !== n) : [...c, n]))}
          clearExtras={() => { setExtras([]); setChecked([]); }}
        />
      )}

      <nav className="fixed inset-x-0 bottom-0 border-t border-line bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto grid max-w-xl grid-cols-4">
          {([
            ["scan", "📸", "Scan"],
            ["pantry", "🧺", "Kitchen"],
            ["cook", "🍳", "Cook"],
            ["shop", "🛒", "Shop"],
          ] as const).map(([id, emoji, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex flex-col items-center gap-0.5 py-3 text-xs font-medium ${tab === id ? "text-tomato" : "text-muted"}`}
            >
              <span className="text-xl">{emoji}</span>
              {label}
              {id === "shop" && shoppingList.length > 0 && (
                <span className="absolute ml-8 -mt-1 rounded-full bg-tomato px-1.5 text-[10px] text-white">{shoppingList.length}</span>
              )}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

/* ───────────────────────── Scan ───────────────────────── */

function ScanTab({ onSaved }: { onSaved: (goToPantry: boolean) => void }) {
  const [location, setLocation] = useState<Location>("fridge");
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ items: { name: string; quantity: number; unit: string }[]; diff: { added: string[]; removed: string[] } } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(file: File) {
    setError(null);
    setResult(null);
    const image = await resizeToDataUrl(file);
    setPreview(image);
    setBusy(true);
    try {
      const r = await fetch("/api/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image, location }) });
      const data = (await readJson(r)) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (!r.ok) throw new Error(data.error ?? "Scan failed");
      setResult(data);
      onSaved(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {LOCATIONS.map((l) => (
          <button
            key={l.id}
            onClick={() => setLocation(l.id)}
            className={`rounded-full px-4 py-2 text-sm font-medium ring-1 transition ${location === l.id ? "bg-ink text-cream ring-ink" : "bg-paper ring-line"}`}
          >
            {l.emoji} {l.label}
          </button>
        ))}
      </div>

      <button
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-3xl border-2 border-dashed border-line bg-paper text-center"
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className={`h-full w-full object-cover ${busy ? "opacity-60" : ""}`} />
        ) : (
          <div className="px-6">
            <div className="text-5xl">📸</div>
            <p className="mt-2 font-display text-xl">Snap your {location}</p>
            <p className="text-sm text-muted">Open the door, take one photo. We’ll list what’s inside.</p>
          </div>
        )}
        {busy && (
          <div className="absolute inset-x-6 bottom-6 rounded-2xl bg-ink/85 px-4 py-3 text-sm text-cream">Reading your {location}…</div>
        )}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }}
      />

      {error && <p className="rounded-2xl bg-tomato/10 p-3 text-sm text-tomato">{error}</p>}

      {result && (
        <div className="space-y-3 rounded-3xl bg-paper p-4 ring-1 ring-line">
          <p className="font-display text-lg">Found {result.items.length} things in your {location}</p>
          {(result.diff.added.length > 0 || result.diff.removed.length > 0) && (
            <div className="flex flex-wrap gap-1.5 text-xs">
              {result.diff.added.map((n) => <span key={"a" + n} className="rounded-full bg-herb/15 px-2 py-0.5 text-herb">+ {n}</span>)}
              {result.diff.removed.map((n) => <span key={"r" + n} className="rounded-full bg-tomato/10 px-2 py-0.5 text-tomato line-through">{n}</span>)}
            </div>
          )}
          <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            {result.items.map((i) => (
              <li key={i.name} className="truncate"><span className="text-muted">{i.quantity}×</span> {i.name}</li>
            ))}
          </ul>
          <button onClick={() => onSaved(true)} className="w-full rounded-2xl bg-ink py-3 font-medium text-cream">See my kitchen →</button>
        </div>
      )}
    </section>
  );
}

/* ───────────────────────── Pantry ───────────────────────── */

function PantryTab({ items, setItems, goScan }: { items: Item[]; setItems: (i: Item[]) => void; goScan: () => void }) {
  const live = items.filter((i) => i.status !== "out");
  const soon = live
    .filter((i) => { const d = daysUntil(i.est_expiry); return d != null && d <= 3; })
    .sort((a, b) => (a.est_expiry ?? "").localeCompare(b.est_expiry ?? ""));

  async function patch(body: object) {
    const r = await fetch("/api/items", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) setItems((await r.json()).items);
  }

  if (live.length === 0)
    return (
      <div className="rounded-3xl bg-paper p-8 text-center ring-1 ring-line">
        <div className="text-5xl">🧺</div>
        <p className="mt-2 font-display text-xl">Your kitchen is a mystery</p>
        <p className="text-sm text-muted">Scan the fridge and a cupboard to get started.</p>
        <button onClick={goScan} className="mt-4 rounded-2xl bg-ink px-5 py-2.5 font-medium text-cream">Start scanning</button>
      </div>
    );

  return (
    <section className="space-y-5">
      {soon.length > 0 && (
        <div className="rounded-3xl bg-butter/30 p-4 ring-1 ring-butter">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink/70">⏰ Use soon</p>
          <div className="flex flex-wrap gap-2">
            {soon.map((i) => {
              const d = daysUntil(i.est_expiry)!;
              return (
                <span key={i.id} className="rounded-full bg-paper px-3 py-1 text-sm ring-1 ring-line">
                  {i.name} <span className={d <= 1 ? "text-tomato" : "text-muted"}>· {d <= 0 ? "today" : d === 1 ? "tomorrow" : `${d}d`}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {LOCATIONS.map((loc) => {
        const here = live.filter((i) => i.location === loc.id);
        if (here.length === 0) return null;
        return (
          <div key={loc.id}>
            <h2 className="mb-2 font-display text-lg">{loc.emoji} {loc.label} <span className="text-sm text-muted">({here.length})</span></h2>
            <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-paper ring-1 ring-line">
              {here.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {i.name}
                      {i.status === "low" && <span className="ml-2 rounded bg-butter/40 px-1.5 text-[10px] uppercase">low</span>}
                    </p>
                    <p className="text-xs text-muted">{i.quantity} {i.unit}{i.est_expiry ? ` · use by ${i.est_expiry.slice(5)}` : ""}</p>
                  </div>
                  <button onClick={() => patch({ id: i.id, status: i.status === "low" ? "have" : "low" })} className="rounded-lg px-2 py-1 text-xs text-muted ring-1 ring-line">
                    {i.status === "low" ? "ok" : "low"}
                  </button>
                  <div className="flex items-center rounded-lg ring-1 ring-line">
                    <button aria-label="less" onClick={() => patch({ id: i.id, quantity: Math.max(0, i.quantity - 1) })} className="px-2.5 py-1">−</button>
                    <button aria-label="more" onClick={() => patch({ id: i.id, quantity: i.quantity + 1 })} className="px-2.5 py-1">+</button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

/* ───────────────────────── Cook ───────────────────────── */

function CookTab({ hasItems, addToList }: { hasItems: boolean; addToList: (names: string[]) => void }) {
  const [constraints, setConstraints] = useState("");
  const [recipes, setRecipes] = useState<Recipe[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/recipes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ constraints }) });
      const data = (await readJson(r)) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (!r.ok) throw new Error(data.error ?? "Couldn't think of anything");
      setRecipes(data.recipes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="rounded-3xl bg-paper p-4 ring-1 ring-line">
        <p className="font-display text-xl">What can we make tonight?</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {["30 min", "kid-friendly", "vegetarian", "one pot"].map((c) => (
            <button
              key={c}
              onClick={() => setConstraints((s) => (s.includes(c) ? s.replace(c, "").replace(/,\s*,/g, ",").replace(/^,\s*|,\s*$/g, "") : s ? `${s}, ${c}` : c))}
              className={`rounded-full px-3 py-1 text-sm ring-1 ${constraints.includes(c) ? "bg-herb text-white ring-herb" : "ring-line"}`}
            >
              {c}
            </button>
          ))}
        </div>
        <button onClick={go} disabled={busy || !hasItems} className="mt-4 w-full rounded-2xl bg-tomato py-3 font-medium text-white disabled:opacity-50">
          {busy ? "Raiding the pantry…" : hasItems ? "🍳 Cook tonight" : "Scan something first"}
        </button>
      </div>

      {error && <p className="rounded-2xl bg-tomato/10 p-3 text-sm text-tomato">{error}</p>}
      {busy && [0, 1, 2].map((k) => <div key={k} className="shimmer h-28 rounded-3xl" />)}

      {!busy &&
        recipes?.map((r, idx) => (
          <article key={r.title} className="rounded-3xl bg-paper p-4 ring-1 ring-line">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-display text-xl leading-tight">{r.title}</h3>
              <span className="shrink-0 rounded-full bg-cream px-2 py-0.5 text-xs text-muted">{r.minutes} min</span>
            </div>
            <p className="mt-1 text-sm text-muted">{r.why}</p>
            <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
              {r.uses.map((u) => (
                <span key={u.name} className={`rounded-full px-2 py-0.5 ${u.expiring ? "bg-butter/40" : "bg-herb/10 text-herb"}`}>
                  {u.expiring && "⏰ "}{u.name} <span className="opacity-60">· {u.location}</span>
                </span>
              ))}
              {r.missing.map((m) => (
                <span key={m} className="rounded-full bg-tomato/10 px-2 py-0.5 text-tomato">+ {m}</span>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={() => setOpen(open === idx ? null : idx)} className="flex-1 rounded-xl py-2 text-sm ring-1 ring-line">
                {open === idx ? "Hide steps" : "Show steps"}
              </button>
              {r.missing.length > 0 && (
                <button onClick={() => addToList(r.missing)} className="flex-1 rounded-xl bg-ink py-2 text-sm text-cream">
                  Add {r.missing.length} to list
                </button>
              )}
            </div>
            {open === idx && (
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
                {r.steps.map((s, i) => <li key={i}>{s}</li>)}
              </ol>
            )}
          </article>
        ))}
    </section>
  );
}

/* ───────────────────────── Shop ───────────────────────── */

function ShopTab({ list, checked, toggle, clearExtras }: { list: string[]; checked: string[]; toggle: (n: string) => void; clearExtras: () => void }) {
  const [place, setPlace] = useState(() => load("sp-place", ""));
  const [basket, setBasket] = useState<Basket | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const todo = list.filter((n) => !checked.includes(n));

  async function findIt() {
    save("sp-place", place);
    setBusy(true);
    setError(null);
    setBasket(null);
    try {
      const r = await fetch("/api/shop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: todo, place }) });
      const data = (await readJson(r)) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (!r.ok) throw new Error(data.error ?? "Agent failed");
      setBasket(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Agent failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="rounded-3xl bg-paper p-4 ring-1 ring-line">
        <div className="flex items-baseline justify-between">
          <p className="font-display text-xl">Shopping list</p>
          {list.length > 0 && <button onClick={clearExtras} className="text-xs text-muted underline">clear</button>}
        </div>
        {list.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Nothing needed. Mark items “low” in your kitchen, or add missing recipe ingredients.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {list.map((n) => (
              <li key={n}>
                <label className="flex items-center gap-3 py-1 text-sm">
                  <input type="checkbox" checked={checked.includes(n)} onChange={() => toggle(n)} className="size-4 accent-herb" />
                  <span className={checked.includes(n) ? "text-muted line-through" : ""}>{n}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      {todo.length > 0 && (
        <div className="rounded-3xl bg-ink p-4 text-cream">
          <p className="font-display text-xl">🤖 Find it for me</p>
          <p className="text-sm opacity-70">An agent searches local shops near you and online stores, then builds a basket.</p>
          <input
            value={place}
            onChange={(e) => setPlace(e.target.value)}
            placeholder="Your town or ZIP, e.g. Park Slope, Brooklyn"
            className="mt-3 w-full rounded-xl bg-cream/10 px-3 py-2.5 text-sm placeholder:text-cream/40 outline-none ring-1 ring-cream/20"
          />
          <button onClick={findIt} disabled={busy || !place} className="mt-3 w-full rounded-2xl bg-butter py-3 font-medium text-ink disabled:opacity-50">
            {busy ? `Shopping for ${todo.length} items…` : `Find ${todo.length} item${todo.length > 1 ? "s" : ""}`}
          </button>
        </div>
      )}

      {error && <p className="rounded-2xl bg-tomato/10 p-3 text-sm text-tomato">{error}</p>}
      {busy && [0, 1].map((k) => <div key={k} className="shimmer h-24 rounded-3xl" />)}

      {basket && (
        <div className="space-y-3">
          <p className="rounded-2xl bg-herb/10 p-3 text-sm text-herb">{basket.summary} <span className="opacity-60">({basket.toolCalls} searches)</span></p>
          {basket.lines.map((l) => (
            <div key={l.item} className="rounded-3xl bg-paper p-4 ring-1 ring-line">
              <p className="font-display text-lg">{l.item}</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {l.local ? (
                  <a href={l.local.url} target="_blank" rel="noreferrer" className="rounded-2xl bg-cream p-3 text-sm ring-1 ring-line">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-herb">📍 Local</p>
                    <p className="font-medium">{l.local.store}</p>
                    <p className="line-clamp-2 text-xs text-muted">{l.local.note}</p>
                  </a>
                ) : <p className="rounded-2xl bg-cream p-3 text-xs text-muted">No local shop found</p>}
                {l.online ? (
                  <a href={l.online.url} target="_blank" rel="noreferrer" className="flex gap-3 rounded-2xl bg-cream p-3 text-sm ring-1 ring-line">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {l.online.image && <img src={l.online.image} alt="" className="size-12 rounded-lg object-cover" />}
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-tomato">🛒 Online · {l.online.store}</p>
                      <p className="line-clamp-2 font-medium">{l.online.title}</p>
                      {l.online.price != null && <p className="text-xs">${l.online.price.toFixed(2)}</p>}
                    </div>
                  </a>
                ) : <p className="rounded-2xl bg-cream p-3 text-xs text-muted">No good online match</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
