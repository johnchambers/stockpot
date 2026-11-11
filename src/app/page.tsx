"use client";

import dynamic from "next/dynamic";

// The app keeps per-device state in localStorage, so render it client-side only.
const Stockpot = dynamic(() => import("./stockpot"), { ssr: false });

export default function Page() {
  return <Stockpot />;
}
