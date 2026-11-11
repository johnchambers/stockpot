"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const WORDS = ["basil", "thyme", "mango", "olive", "pepper", "lemon", "clove", "ginger", "fig", "sage", "plum", "kale"];

function newHouseholdId() {
  const pick = () => WORDS[crypto.getRandomValues(new Uint32Array(1))[0] % WORDS.length];
  const tail = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
  return `${pick()}-${pick()}-${tail}`;
}

/** "/" sends you to your household: the last one you opened on this device, or a brand-new one. */
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    let h: string | null = null;
    try {
      h = localStorage.getItem("sp-household");
    } catch {}
    router.replace(`/h/${h ?? newHouseholdId()}`);
  }, [router]);
  return <div className="p-8 text-center text-muted">Opening your kitchen…</div>;
}
