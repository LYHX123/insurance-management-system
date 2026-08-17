import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { isProductionInitializationEnabled } from "@/lib/productionInit/constants";
import { isModuleAvailable, type InitializationModule } from "@/lib/productionInit/modules";
import { validateInitializationSelection } from "@/lib/productionInit/validateSelection";

// Read-only pre-flight check for the Selective Initialization UI — lets the
// panel show dependency violations BEFORE opening the typed-confirmation
// step (this phase's spec, Part 六). Never the authoritative gate on its
// own: runSelectiveProductionInitialization re-validates fresh, under the
// row lock, inside its own transaction before deleting anything.
const VALID_MODULES: InitializationModule[] = ["CUSTOMER", "QUOTATION", "POLICY", "INVOICE", "LEDGER", "TASK", "REMINDER", "USERS", "SETTINGS"];

export async function POST(req: NextRequest) {
  if (!isProductionInitializationEnabled()) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!isAdmin(session.user)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_REQUEST_BODY" }, { status: 400 });
  }

  const raw = (body as { modules?: unknown })?.modules;
  if (!Array.isArray(raw) || raw.length === 0) {
    return NextResponse.json({ error: "NO_MODULES_SELECTED" }, { status: 400 });
  }
  const modules: InitializationModule[] = [];
  for (const m of raw) {
    if (typeof m !== "string" || !VALID_MODULES.includes(m as InitializationModule)) {
      return NextResponse.json({ error: "INVALID_MODULE" }, { status: 400 });
    }
    modules.push(m as InitializationModule);
  }
  const unavailable = modules.find((m) => !isModuleAvailable(m));
  if (unavailable) {
    return NextResponse.json({ error: "MODULE_UNAVAILABLE", module: unavailable }, { status: 400 });
  }

  const result = await validateInitializationSelection(new Set(modules));
  return NextResponse.json(result);
}
