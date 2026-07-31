import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { isProductionInitializationEnabled } from "@/lib/productionInit/constants";
import { getProductionInitializationPreview } from "@/lib/productionInit/preview";
import { getProductionInitializationStatus } from "@/lib/productionInit/status";

// Read-only. Never mutates anything (see getProductionInitializationPreview's
// own doc comment) — safe to call as often as the Settings panel wants,
// including the mandatory refresh-before-confirm step (this feature's spec,
// Part 6: "前端正式确认前必须刷新一次Preview").
export async function GET() {
  // Feature-flag check first, independent of auth state — a disabled
  // deployment must not even reveal (via a 401/403 instead of 404) that
  // this route means anything (Part 3).
  if (!isProductionInitializationEnabled()) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  // Distinguish "not logged in" (401) from "logged in but not Admin" (403)
  // — this feature's spec requires both, not a single collapsed status.
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!isAdmin(session.user)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const [preview, status] = await Promise.all([getProductionInitializationPreview(), getProductionInitializationStatus()]);

  return NextResponse.json({ preview, status });
}
