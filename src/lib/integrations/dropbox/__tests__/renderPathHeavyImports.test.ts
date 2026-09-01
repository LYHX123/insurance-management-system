import { describe, it, expect, vi } from "vitest";

// Regression guard for the "Jest worker encountered N child process
// exceptions" / stale-Turbopack-worker failure that hit the Motor Policy
// detail page (and, by the same import chain, every Policy detail page).
//
// Root cause was a purely-static dependency edge:
//
//   policy/<cat>/[id]/page.tsx
//     -> lib/integrations/dropbox/policyPathViewModel.ts   (render-time: path strings only)
//       -> policyBusinessFile.ts
//         -> quotationDropboxSync.ts
//           -> @/lib/quotationTemplateEngine  (ExcelJS + JSZip)   <-- dragged into SSR graph
//
//   ...and, in parallel, policyPathViewModel -> service.ts -> {auth,client,
//   migration/config} -> the ~1MB `dropbox` SDK.
//
// None of that runtime is needed to RENDER a detail page — only to generate
// an Excel workbook / talk to the Dropbox API, both of which are explicit
// user actions. The fix moved those to call-site `await import(...)`. These
// tests fail if any of that heavy runtime creeps back into the eager module
// graph a Policy/Quotation/Customer detail page pulls in at render time.

const heavyLoaded = vi.hoisted(() => ({ exceljs: false, jszip: false, dropbox: false }));

vi.mock("exceljs", () => {
  heavyLoaded.exceljs = true;
  return { default: class Workbook {}, Workbook: class Workbook {} };
});
vi.mock("jszip", () => {
  heavyLoaded.jszip = true;
  return { default: class JSZip {} };
});
vi.mock("dropbox", () => {
  heavyLoaded.dropbox = true;
  return { Dropbox: class Dropbox {}, DropboxAuth: class DropboxAuth {} };
});

// Keep the test hermetic — no real pg pool / DB connection, matching the
// rest of this suite. The heavy-import detection above is unaffected.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

// The exact modules a Policy/Quotation/Customer detail page evaluates at
// render time to build its read-only "Dropbox Filing" view model.
const RENDER_PATH_MODULES = [
  "@/lib/integrations/dropbox/policyPathViewModel",
  "@/lib/integrations/dropbox/quotationPathViewModel",
  "@/lib/integrations/dropbox/customerPathViewModel",
  "@/lib/integrations/dropbox/invoicePathViewModel",
  "@/lib/integrations/dropbox/service",
  "@/lib/integrations/dropbox/migration/view",
];

describe("Policy/Quotation/Customer detail render path stays free of the Excel/Dropbox runtime", () => {
  for (const modulePath of RENDER_PATH_MODULES) {
    it(`does not eagerly load ExcelJS / JSZip / the Dropbox SDK: ${modulePath}`, async () => {
      await expect(import(modulePath)).resolves.toBeTruthy();
      expect(heavyLoaded, `${modulePath} pulled a heavy module into the eager graph`).toEqual({
        exceljs: false,
        jszip: false,
        dropbox: false,
      });
    });
  }
});
