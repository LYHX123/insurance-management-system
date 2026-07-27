"use server";

import { randomUUID } from "crypto";
import path from "path";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { storageService } from "@/lib/storage";
import { isValidKenyanPhone } from "@/lib/validators";
import {
  SYSTEM_SETTINGS_ID,
  ALLOWED_LOGO_MIME_TYPES,
  MAX_LOGO_FILE_SIZE_BYTES,
  isAllowedLogoMimeType,
  isSupportedCurrency,
  isSupportedDateFormat,
  isSupportedTimeFormat,
  isSupportedTimezone,
  isValidRecordsPerPage,
  isValidReminderDays,
} from "@/lib/settings/constants";
import type { Locale } from "@/generated/prisma/enums";

type ActionResult = { success: true } | { success: false; error: string };

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOGO_FOLDER = "settings/logo";

// ============================================================================
// Company Information
// ============================================================================

export type CompanyInfoInput = {
  companyName?: string | null;
  pinNumber?: string | null;
  phoneNumber?: string | null;
  email?: string | null;
  address?: string | null;
  website?: string | null;
};

export async function updateCompanyInfoAction(data: CompanyInfoInput): Promise<ActionResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const phoneNumber = data.phoneNumber?.trim() || null;
  if (phoneNumber && !isValidKenyanPhone(phoneNumber)) {
    return { success: false, error: "INVALID_PHONE" };
  }

  const email = data.email?.trim() || null;
  if (email && !EMAIL_REGEX.test(email)) {
    return { success: false, error: "INVALID_EMAIL" };
  }

  const fields = {
    companyName: data.companyName?.trim() || null,
    pinNumber: data.pinNumber?.trim() || null,
    phoneNumber,
    email,
    address: data.address?.trim() || null,
    website: data.website?.trim() || null,
    updatedById: session.user.id,
  };

  await prisma.systemSettings.upsert({
    where: { id: SYSTEM_SETTINGS_ID },
    update: fields,
    create: { id: SYSTEM_SETTINGS_ID, ...fields },
  });

  revalidatePath("/settings");
  return { success: true };
}

// ============================================================================
// Company Logo — reuses the existing local storage abstraction
// (src/lib/storage), same pattern as CustomerDocument/PolicyDocument
// uploads: a random on-disk name, never the original filename, and the
// physical storageKey is never exposed to the client (only served back
// through the protected /api/settings/logo route).
// ============================================================================

export async function uploadLogoAction(formData: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, error: "FILE_REQUIRED" };
  }
  if (file.size > MAX_LOGO_FILE_SIZE_BYTES) {
    return { success: false, error: "FILE_TOO_LARGE" };
  }
  if (!isAllowedLogoMimeType(file.type)) {
    return { success: false, error: "UNSUPPORTED_FILE_TYPE" };
  }

  const ext = ALLOWED_LOGO_MIME_TYPES[file.type] || path.extname(file.name);
  const storedFileName = `${randomUUID()}${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  let storageKey: string;
  try {
    await storageService.createFolder(LOGO_FOLDER);
    const uploaded = await storageService.uploadFile({
      folderPath: LOGO_FOLDER,
      fileName: storedFileName,
      buffer,
      mimeType: file.type,
    });
    storageKey = uploaded.storageKey;
  } catch (err) {
    console.error("Failed to store company logo:", err);
    return { success: false, error: "UPLOAD_FAILED" };
  }

  const existing = await prisma.systemSettings.findUnique({ where: { id: SYSTEM_SETTINGS_ID } });
  const previousKey = existing?.logoStorageKey ?? null;

  await prisma.systemSettings.upsert({
    where: { id: SYSTEM_SETTINGS_ID },
    update: { logoStorageKey: storageKey, logoMimeType: file.type, updatedById: session.user.id },
    create: { id: SYSTEM_SETTINGS_ID, logoStorageKey: storageKey, logoMimeType: file.type, updatedById: session.user.id },
  });

  // Replace only after the new file+row are committed, and only the exact
  // previous file — never anything else in the folder.
  if (previousKey && previousKey !== storageKey) {
    await storageService.deleteFile(previousKey).catch((err) => {
      console.error("Failed to delete previous company logo file:", err);
    });
  }

  revalidatePath("/settings");
  return { success: true };
}

export async function removeLogoAction(): Promise<ActionResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const existing = await prisma.systemSettings.findUnique({ where: { id: SYSTEM_SETTINGS_ID } });
  if (existing?.logoStorageKey) {
    await storageService.deleteFile(existing.logoStorageKey).catch((err) => {
      console.error("Failed to delete company logo file:", err);
    });
  }

  await prisma.systemSettings.upsert({
    where: { id: SYSTEM_SETTINGS_ID },
    update: { logoStorageKey: null, logoMimeType: null, updatedById: session.user.id },
    create: { id: SYSTEM_SETTINGS_ID, updatedById: session.user.id },
  });

  revalidatePath("/settings");
  return { success: true };
}

// ============================================================================
// System Preferences
// ============================================================================

export type SystemPreferencesInput = {
  defaultCurrency: string;
  defaultTimezone: string;
  dateFormat: string;
  timeFormat: string;
  defaultLanguage: Locale;
  recordsPerPage: number;
};

export async function updateSystemPreferencesAction(data: SystemPreferencesInput): Promise<ActionResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  if (!isSupportedCurrency(data.defaultCurrency)) return { success: false, error: "INVALID_CURRENCY" };
  if (!isSupportedTimezone(data.defaultTimezone)) return { success: false, error: "INVALID_TIMEZONE" };
  if (!isSupportedDateFormat(data.dateFormat)) return { success: false, error: "INVALID_DATE_FORMAT" };
  if (!isSupportedTimeFormat(data.timeFormat)) return { success: false, error: "INVALID_TIME_FORMAT" };
  if (data.defaultLanguage !== "en" && data.defaultLanguage !== "zh") {
    return { success: false, error: "INVALID_LANGUAGE" };
  }
  if (!isValidRecordsPerPage(data.recordsPerPage)) return { success: false, error: "INVALID_RECORDS_PER_PAGE" };

  const fields = { ...data, updatedById: session.user.id };

  await prisma.systemSettings.upsert({
    where: { id: SYSTEM_SETTINGS_ID },
    update: fields,
    create: { id: SYSTEM_SETTINGS_ID, ...fields },
  });

  revalidatePath("/settings");
  return { success: true };
}

// ============================================================================
// Reminder Settings
// ============================================================================

export type ReminderSettingsInput = {
  policyRemindersEnabled: boolean;
  motorPolicyReminderDays: number;
  otherPolicyReminderDays: number;
  dailyTaskRemindersEnabled: boolean;
  dailyTaskReminderDays: number;
  claimRemindersEnabled: boolean;
  claimReminderDays: number;
  loginReminderPopupEnabled: boolean;
};

export async function updateReminderSettingsAction(data: ReminderSettingsInput): Promise<ActionResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const dayValues = [
    data.motorPolicyReminderDays,
    data.otherPolicyReminderDays,
    data.dailyTaskReminderDays,
    data.claimReminderDays,
  ];
  if (dayValues.some((d) => !isValidReminderDays(d))) {
    return { success: false, error: "INVALID_REMINDER_DAYS" };
  }

  const fields = { ...data, updatedById: session.user.id };

  // A single upsert is already one atomic statement — every reminder field
  // is written together or not at all.
  await prisma.systemSettings.upsert({
    where: { id: SYSTEM_SETTINGS_ID },
    update: fields,
    create: { id: SYSTEM_SETTINGS_ID, ...fields },
  });

  revalidatePath("/settings");
  return { success: true };
}
