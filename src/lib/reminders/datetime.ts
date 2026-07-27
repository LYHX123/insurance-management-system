// Calendar-day arithmetic in a given IANA timezone, using only native Intl
// (this project has no date library — see src/lib/settings/constants.ts's
// doc comment on why timezone/format values are validated allowlists
// rather than a library-backed type). Never divides raw milliseconds
// directly: that approach silently produces an off-by-one day whenever the
// instant-to-instant difference crosses a timezone's local midnight at a
// non-24-hour offset from UTC, which a plain `/ 86400000` cannot detect.
//
// Originally written for the reminder engine; the Dashboard's Today/This
// Week/This Month range boundaries (src/lib/dashboard/service.ts) reuse the
// same primitives rather than a second timezone implementation.

// "YYYY-MM-DD" as observed in `timeZone` — en-CA formats dates in exactly
// this order, which is the only reason that locale is used here.
export function dateKeyInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

// Calendar days from `from` to `to` as observed in `timeZone` — positive
// when `to` is later, 0 for the same calendar day, negative when earlier.
// Computed by comparing the two "YYYY-MM-DD" keys as UTC midnights, which
// sidesteps DST entirely (the subtraction never touches the timezone's
// actual offset, only the calendar-day count).
export function calendarDaysBetween(from: Date, to: Date, timeZone: string): number {
  const fromKey = dateKeyInTimeZone(from, timeZone);
  const toKey = dateKeyInTimeZone(to, timeZone);
  const fromUtc = Date.parse(`${fromKey}T00:00:00Z`);
  const toUtc = Date.parse(`${toKey}T00:00:00Z`);
  return Math.round((toUtc - fromUtc) / 86_400_000);
}

// Days remaining until `dueDate` (negative if already past), as observed in
// `timeZone`, measured from `now`.
export function daysRemaining(dueDate: Date, timeZone: string, now: Date = new Date()): number {
  return calendarDaysBetween(now, dueDate, timeZone);
}

// Days elapsed since `pastDate` (0 if today), as observed in `timeZone`,
// measured up to `now`. Negative inputs (a "past" date that is actually in
// the future) are clamped to 0 — never produces a nonsensical negative
// "days since" value.
export function daysSince(pastDate: Date, timeZone: string, now: Date = new Date()): number {
  return Math.max(0, calendarDaysBetween(pastDate, now, timeZone));
}

// Defensive parse used at every reminder-generation boundary (Part 20.5/20.6:
// "invalid or missing dates must not crash reminder generation"). Returns
// null for anything that isn't a valid Date, so callers can skip the record.
export function toValidDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// ---------------------------------------------------------------------------
// Calendar-day range boundaries (Dashboard Today / This Week / This Month) —
// each returns a real UTC instant usable directly in a Prisma `gte`/`lt`
// where clause, not just a day count.
// ---------------------------------------------------------------------------

// Minutes to ADD to a UTC instant to get the wall-clock time in `timeZone`
// (e.g. +180 for Africa/Nairobi). Recomputed near `date` rather than
// hard-coded, so a timezone that does observe DST would still resolve
// correctly for the date in question.
function timeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // Midnight in a 24-hour format is sometimes reported as "24" by Intl.
  const hour = get("hour") === 24 ? 0 : get("hour");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  return (asUtc - date.getTime()) / 60_000;
}

// The UTC instant corresponding to local midnight (start of calendar day)
// for `date`, as observed in `timeZone`.
export function startOfDayInTimeZone(date: Date, timeZone: string): Date {
  const key = dateKeyInTimeZone(date, timeZone);
  const utcMidnightGuess = new Date(`${key}T00:00:00.000Z`);
  const offsetMinutes = timeZoneOffsetMinutes(utcMidnightGuess, timeZone);
  return new Date(utcMidnightGuess.getTime() - offsetMinutes * 60_000);
}

// Start of the current calendar day's Monday-through-Sunday week.
export function startOfWeekInTimeZone(date: Date, timeZone: string): Date {
  const startOfToday = startOfDayInTimeZone(date, timeZone);
  const key = dateKeyInTimeZone(date, timeZone);
  // The key is a pure calendar date with no time-of-day ambiguity, so
  // reading its UTC day-of-week is timezone-agnostic (0 = Sunday).
  const dayOfWeek = new Date(`${key}T00:00:00Z`).getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7; // Mon=0, Tue=1, ..., Sun=6
  return new Date(startOfToday.getTime() - daysSinceMonday * 86_400_000);
}

// Start of the current calendar month (the 1st, local midnight).
export function startOfMonthInTimeZone(date: Date, timeZone: string): Date {
  const key = dateKeyInTimeZone(date, timeZone);
  const [year, month] = key.split("-").map(Number);
  const utcMidnightGuess = new Date(Date.UTC(year, month - 1, 1));
  const offsetMinutes = timeZoneOffsetMinutes(utcMidnightGuess, timeZone);
  return new Date(utcMidnightGuess.getTime() - offsetMinutes * 60_000);
}

// Start of the calendar month immediately after `date`'s — used as the
// exclusive upper bound of a "this month" range.
export function startOfNextMonthInTimeZone(date: Date, timeZone: string): Date {
  const key = dateKeyInTimeZone(date, timeZone);
  const [year, month] = key.split("-").map(Number);
  const nextMonthUtc = new Date(Date.UTC(year, month, 1)); // JS Date rolls over automatically
  const offsetMinutes = timeZoneOffsetMinutes(nextMonthUtc, timeZone);
  return new Date(nextMonthUtc.getTime() - offsetMinutes * 60_000);
}

export type DateRange = { gte: Date; lt: Date };

// Convenience: [start of today, start of tomorrow).
export function todayRange(timeZone: string, now: Date = new Date()): DateRange {
  const start = startOfDayInTimeZone(now, timeZone);
  return { gte: start, lt: new Date(start.getTime() + 86_400_000) };
}

// Convenience: [Monday 00:00 this week, Monday 00:00 next week).
export function thisWeekRange(timeZone: string, now: Date = new Date()): DateRange {
  const start = startOfWeekInTimeZone(now, timeZone);
  return { gte: start, lt: new Date(start.getTime() + 7 * 86_400_000) };
}

// Convenience: [1st of this month 00:00, 1st of next month 00:00).
export function thisMonthRange(timeZone: string, now: Date = new Date()): DateRange {
  return { gte: startOfMonthInTimeZone(now, timeZone), lt: startOfNextMonthInTimeZone(now, timeZone) };
}
