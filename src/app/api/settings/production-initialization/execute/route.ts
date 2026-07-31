import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { isProductionInitializationEnabled } from "@/lib/productionInit/constants";
import { runProductionInitialization } from "@/lib/productionInit/execute";

// Best-effort only (Part 9 of this feature's spec: "如果容易实现") — this
// project has no existing IP-extraction convention to reuse. Reads the
// standard reverse-proxy header this app's own Caddyfile/docker-compose
// setup would set; falls back to null rather than guessing.
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
  ALREADY_RUNNING: 409,
  COOLDOWN_ACTIVE: 409,
  TRANSACTION_FAILED: 500,
};

export async function POST(req: NextRequest) {
  // Feature-flag check first, independent of auth state (Part 3, same
  // reasoning as the preview route).
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

  const confirmationText = typeof (body as { confirmationText?: unknown })?.confirmationText === "string" ? (body as { confirmationText: string }).confirmationText : "";
  const backupConfirmed = (body as { backupConfirmed?: unknown })?.backupConfirmed === true;
  const reason = (body as { reason?: unknown })?.reason;

  const result = await runProductionInitialization({
    confirmationText,
    backupConfirmed,
    reason,
    ipAddress: extractIpAddress(req),
    userAgent: req.headers.get("user-agent"),
  });

  if (!result.success) {
    const status = ERROR_STATUS[result.error] ?? 500;
    return NextResponse.json({ error: result.error, message: result.message, nextAvailableAt: result.nextAvailableAt }, { status });
  }

  return NextResponse.json(result, { status: 200 });
}
