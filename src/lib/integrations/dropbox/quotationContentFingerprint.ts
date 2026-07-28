// Server-only, pure and deterministic. Dropbox Integration Phase 4, Part 6
// — a content fingerprint used to decide whether a Quotation's generated
// artifact actually changed since the last synchronized version. Callers
// pass in the same nested Quotation+sections+detail-rows object already
// used to generate the Excel workbook (Part 6, requirement 9: "derive from
// the actual Quotation data used to generate the workbook"); this module
// never queries the database itself.
import { createHash } from "crypto";

// Fields that vary on every read/write without representing a real content
// change — excluded so re-downloading or retrying never looks like an edit
// (Part 6, requirement 9: "excluding volatile fields such as generated
// timestamp, download count, sync timestamps"). Deliberately matched by
// bare key name (not path) since these primary/foreign key and timestamp
// names never carry meaningful content anywhere in this data shape.
const VOLATILE_KEY_PATTERN = /^(id|sectionId|quotationId|createdAt|updatedAt|generatedAt|lastSyncedAt|downloadCount)$/;

function stripVolatileKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripVolatileKeys);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    // Decimal/Date-like objects expose their own toJSON() (Prisma.Decimal,
    // Date) — leave them as-is so JSON.stringify serializes them through
    // that, rather than recursing into their internal representation.
    if (typeof (value as { toJSON?: unknown }).toJSON === "function") return value;
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (VOLATILE_KEY_PATTERN.test(key)) continue;
      out[key] = stripVolatileKeys(nested);
    }
    return out;
  }
  return value;
}

export function computeQuotationContentFingerprint(quotationExportShape: unknown): string {
  const cleaned = stripVolatileKeys(quotationExportShape);
  const json = JSON.stringify(cleaned);
  return createHash("sha256").update(json).digest("hex");
}
