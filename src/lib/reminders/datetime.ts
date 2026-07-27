// Calendar-day arithmetic in a given IANA timezone, using only native Intl
// (this project has no date library — see src/lib/settings/constants.ts's
// doc comment on why timezone/format values are validated allowlists
// rather than a library-backed type). Never divides raw milliseconds
// directly: that approach silently produces an off-by-one day whenever the
// instant-to-instant difference crosses a timezone's local midnight at a
// non-24-hour offset from UTC, which a plain `/ 86400000` cannot detect.

// "YYYY-MM-DD" as observed in `timeZone` — en-CA formats dates in exactly
// this order, which is the only reason that locale is used here.
function dateKeyInTimeZone(date: Date, timeZone: string): string {
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
