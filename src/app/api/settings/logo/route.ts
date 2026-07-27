import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/authz";
import { getSystemSettings } from "@/lib/settings/service";
import { storageService } from "@/lib/storage";

// ADMIN-only, mirroring the rest of the Settings module (Part 2) — the logo
// is not surfaced anywhere else in the app in this phase, so it never needs
// to be readable by a non-admin.
export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const settings = await getSystemSettings();
  if (!settings.logoStorageKey || !settings.logoMimeType) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  let buffer: Buffer;
  try {
    buffer = await storageService.downloadFile(settings.logoStorageKey);
  } catch (err) {
    console.error("Failed to read company logo file:", err);
    return NextResponse.json({ error: "FILE_MISSING" }, { status: 404 });
  }

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": settings.logoMimeType,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
