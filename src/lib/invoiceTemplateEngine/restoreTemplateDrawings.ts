// ExcelJS's OOXML writer only understands picture anchors (<xdr:pic>) inside
// xl/drawings/*.xml. Any other drawing shape is silently dropped the moment
// a workbook loaded via workbook.xlsx.load() is re-serialized with
// workbook.xlsx.writeBuffer() — confirmed by inspecting this template's
// real xl/drawings/drawing1.xml: it contains both the logo <xdr:pic> AND a
// separate <xdr:sp> text-box shape (the "ENFB INSURANCE AGENCY LIMITED /
// CHAKA PLACE, ARGWINGS KODHEK ROAD, NAIROBI" company name/address box).
// Round-tripping the pristine template through ExcelJS with no other
// changes reproduces this exactly: the logo survives, the text box does
// not — this is the same limitation already documented and worked around
// in src/lib/quotationTemplateEngine/restoreTemplateDrawings.ts, whose
// approach this mirrors.
//
// Rather than replace the ExcelJS-based fill pipeline (row splicing /
// style copying / placeholder replacement all depend on its cell/row/merge
// APIs and work correctly), this patches only the one part ExcelJS mangles:
// after writeBuffer() produces the final workbook, every xl/drawings/*.xml
// part is overwritten with the byte-identical part from the original
// template file. This is safe specifically because none of this engine's
// row insertion/deletion ever touches row 0 (both the logo and the text
// box are anchored entirely within row 0 — see detectTemplateStructure's
// item row, always at row 5 or below in the shipped template) — the
// drawing's anchors never need row-shifting. The relationship ids inside
// drawing1.xml (rId1 -> image1.png) are unchanged by anything ExcelJS
// does to the rest of the workbook, so this is a safe drop-in swap, not a
// rebuild.
import JSZip from "jszip";
import { readFile } from "fs/promises";
import path from "path";
import { INVOICE_TEMPLATE_RELATIVE_PATH } from "./config";

export async function restoreTemplateDrawings(generatedBuffer: Buffer): Promise<Buffer> {
  const templatePath = path.join(/* turbopackIgnore: true */ process.cwd(), INVOICE_TEMPLATE_RELATIVE_PATH);
  const originalBuffer = await readFile(templatePath);

  const [originalZip, generatedZip] = await Promise.all([
    JSZip.loadAsync(originalBuffer),
    JSZip.loadAsync(generatedBuffer),
  ]);

  const drawingParts = Object.keys(originalZip.files).filter((name) => name.startsWith("xl/drawings/"));

  for (const name of drawingParts) {
    const original = originalZip.file(name);
    if (!original) continue;
    // Only overwrite parts ExcelJS still emitted (still referenced by the
    // worksheet) — never inject a part that has nothing pointing at it.
    if (!generatedZip.file(name)) continue;
    const content = await original.async("nodebuffer");
    generatedZip.file(name, content);
  }

  return generatedZip.generateAsync({ type: "nodebuffer" });
}
