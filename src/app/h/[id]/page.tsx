import { Suspense } from "react";
import Household from "./household";

export default function HouseholdPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-muted">Opening your kitchen…</div>}>
      <Household />
    </Suspense>
  );
}
