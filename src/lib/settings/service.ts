import { prisma } from "@/lib/prisma";
import { SYSTEM_SETTINGS_ID } from "./constants";
import type { SystemSettingsModel } from "@/generated/prisma/models";

// The single read path for the SystemSettings singleton row. Uses an
// upsert-on-read (idempotent: safe to call concurrently or repeatedly,
// never creates a second row because the id is fixed) rather than
// requiring a separate one-time seed step — every schema default already
// lives on the model itself (see prisma/schema.prisma), so an empty
// `create: {}` is exactly "the documented defaults".
export async function getSystemSettings(): Promise<SystemSettingsModel> {
  return prisma.systemSettings.upsert({
    where: { id: SYSTEM_SETTINGS_ID },
    update: {},
    create: { id: SYSTEM_SETTINGS_ID },
  });
}
