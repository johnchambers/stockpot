"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useEffect } from "react";

// The app keeps per-device state in localStorage, so render it client-side only.
const Stockpot = dynamic(() => import("../../stockpot"), { ssr: false });

export default function Household() {
  const { id } = useParams<{ id: string }>();
  const valid = /^[a-z0-9-]{8,48}$/.test(id);
  useEffect(() => {
    // Remember the household so "/" (and the home-screen icon) reopens it.
    if (valid) try { localStorage.setItem("sp-household", id); } catch {}
  }, [id, valid]);
  if (!valid) return <div className="p-8 text-center">That kitchen link doesn’t look right.</div>;
  return <Stockpot key={id} household={id} />;
}
