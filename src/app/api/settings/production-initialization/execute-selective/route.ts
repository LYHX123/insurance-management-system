import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { isProductionInitializationEnabled } from "@/lib/productionInit/constants";
import { runSelectiveProductionInitialization } from "@/lib/productionInit/executeSelective";

// Mirrors execute/route.ts's own IP-extraction helper exactly (duplicated,
// not imported — that route/module is left untouched, see
// executeSelective.ts's own doc comment for why this feature intentionally
// duplicates a few small pieces rather than refactoring the existing,
// already-audited full-wipe path).
function extractIpAddress(req: NextRequest): string | null {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]!.trim();
  return req.headers.get("x-real-ip");
}

const ERROR_STATUS: Record<string, number> = {
  DISABLED: 404,
  FORBIDDEN: 403,
  INVALID_CONFIRMATION: 400,
  BACKUP_NOT_CONFIRMED: 400,
  INVALID_REASON: 400,
  NO_MODULES_SELECTED: 400,
  INVALID_MODULE: 400,
  MODULE_UNAVAILABLE: 400,
  DEPENDENCY_VIOLATION: 409,
  ALREADY_RUNNING: 409,
  COOLDOWN_ACTIVE: 409,
  TRANSACTION_FAILED: 500,
};

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

  const modules = (body as { modules?: unknown })?.modules;
  const confirmationText = typeof (body as { confirmationText?: unknown })?.confirmationText === "string" ? (body as { confirmationText: string }).confirmationText : "";
  const backupConfirmed = (body as { backupConfirmed?: unknown })?.backupConfirmed === true;
  const reason = (body as { reason?: unknown })?.reason;

  const result = await runSelectiveProductionInitialization({
    modules,
    confirmationText,
    backupConfirmed,
    reason,
    ipAddress: extractIpAddress(req),
    userAgent: req.headers.get("user-agent"),
  });

  if (!result.success) {
    const status = ERROR_STATUS[result.error] ?? 500;
    const body: Record<string, unknown> = { error: result.error, message: result.message };
    if ("nextAvailableAt" in result) body.nextAvailableAt = result.nextAvailableAt;
    if ("violations" in result) body.violations = result.violations;
    return NextResponse.json(body, { status });
  }

  return NextResponse.json(result, { status: 200 });
}
