"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";

export type Pin = { name: string; lat: number; lng: number; kind: "home" | "shop" };

/** Small Leaflet map: your area plus numbered shop pins, fitted to bounds. */
export default function ShopMap({ pins }: { pins: Pin[] }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let map: import("leaflet").Map | undefined;
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled || !el.current) return;
      map = L.map(el.current, { scrollWheelZoom: false, attributionControl: true });
      L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
        maxZoom: 19,
      }).addTo(map);
      let n = 0;
      const markers = pins.map((p) => {
        const label = p.kind === "home" ? "🏠" : String(++n);
        const icon = L.divIcon({
          className: "",
          html: `<div style="display:grid;place-items:center;width:30px;height:30px;border-radius:999px;border:2px solid #fffaf1;box-shadow:0 2px 8px rgba(43,33,24,.35);font:600 13px system-ui;color:#fffaf1;background:${p.kind === "home" ? "#2b2118" : "#d9472b"}">${label}</div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        });
        return L.marker([p.lat, p.lng], { icon }).bindTooltip(p.name).addTo(map!);
      });
      if (markers.length) map.fitBounds(L.featureGroup(markers).getBounds().pad(0.3), { maxZoom: 16 });
    });
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [pins]);
  return <div ref={el} className="h-64 w-full overflow-hidden rounded-2xl border border-line" />;
}
