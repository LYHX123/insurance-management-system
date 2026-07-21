// Revision-aware download filename, e.g.:
//   "QT202607-081-R01 - China Jiangxi International Kenya Limited - CAR, WIBA.xlsx"
// Deliberately built at the API route level, not inside
// quotationTemplateEngine/ or the legacy excel exporter — neither engine's
// own internal logic changes for this; only what filename the browser saves
// the download as.
const UNSAFE_FILENAME_CHARS = /[\\/:*?"<>|]/g;

function sanitize(part: string): string {
  return part.replace(UNSAFE_FILENAME_CHARS, "-").trim();
}

export function buildRevisionExcelFilename(params: {
  quotationNumber: string;
  revisionCode: string | null;
  customerName: string;
  insuranceTypeNames: string[];
}): string {
  const code = params.revisionCode ?? "R01";
  const types = params.insuranceTypeNames.length > 0 ? params.insuranceTypeNames.join(", ") : "Quotation";
  const namePart = sanitize(`${params.quotationNumber}-${code} - ${params.customerName} - ${types}`);
  return `${namePart}.xlsx`;
}
