// Phase 13A — builds the query string for a list's "Export Excel" link from
// the same filter state the list renders from, dropping default / empty
// values so the URL (and the server route's "is this filtered?" check) stays
// clean. `true` serialises to "1" (the checkbox-filter convention); "ALL" and
// "" are treated as "no filter".

export function buildListExportHref(
  basePath: string,
  params: Record<string, string | boolean | null | undefined>
): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "" || value === false || value === "ALL") continue;
    sp.set(key, value === true ? "1" : String(value));
  }
  const qs = sp.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
