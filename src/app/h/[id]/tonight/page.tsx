import { Suspense } from "react";
import Tonight from "./tonight";

export default function TonightPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-muted">Plating up…</div>}>
      <Tonight />
    </Suspense>
  );
}
