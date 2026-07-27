// Fixed, known primary key — the single mechanism that makes SystemSettings
// a true singleton (every read/write targets this exact id; a second row
// can never be created by accident). See service.ts.
export const SYSTEM_SETTINGS_ID = "singleton";

// Controlled value lists (Part 5.1/5.2: "use dropdowns for controlled
// values", "do not allow arbitrary invalid timezone or date-format
// strings") — validated at the app layer rather than as DB enums, so adding
// a new supported option later never requires a migration (same convention
// as MotorPolicyDetail.insuranceType's known-values list).
export const SUPPORTED_CURRENCIES = ["KES", "USD"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export const SUPPORTED_TIMEZONES = [
  "Africa/Nairobi",
  "Africa/Johannesburg",
  "Africa/Lagos",
  "Etc/UTC",
] as const;
export type SupportedTimezone = (typeof SUPPORTED_TIMEZONES)[number];

export const SUPPORTED_DATE_FORMATS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"] as const;
export type SupportedDateFormat = (typeof SUPPORTED_DATE_FORMATS)[number];

export const SUPPORTED_TIME_FORMATS = ["12H", "24H"] as const;
export type SupportedTimeFormat = (typeof SUPPORTED_TIME_FORMATS)[number];

export const MIN_REMINDER_DAYS = 0;
export const MAX_REMINDER_DAYS = 365;
export const MIN_RECORDS_PER_PAGE = 5;
export const MAX_RECORDS_PER_PAGE = 200;

export function isSupportedCurrency(value: string): value is SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}
export function isSupportedTimezone(value: string): value is SupportedTimezone {
  return (SUPPORTED_TIMEZONES as readonly string[]).includes(value);
}
export function isSupportedDateFormat(value: string): value is SupportedDateFormat {
  return (SUPPORTED_DATE_FORMATS as readonly string[]).includes(value);
}
export function isSupportedTimeFormat(value: string): value is SupportedTimeFormat {
  return (SUPPORTED_TIME_FORMATS as readonly string[]).includes(value);
}
export function isValidReminderDays(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_REMINDER_DAYS && value <= MAX_REMINDER_DAYS;
}
export function isValidRecordsPerPage(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_RECORDS_PER_PAGE && value <= MAX_RECORDS_PER_PAGE;
}

export const ALLOWED_LOGO_MIME_TYPES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};
export function isAllowedLogoMimeType(mimeType: string): boolean {
  return mimeType in ALLOWED_LOGO_MIME_TYPES;
}
export const MAX_LOGO_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB — a logo, not a document.
