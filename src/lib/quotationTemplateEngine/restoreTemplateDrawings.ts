// ExcelJS's OOXML writer only understands picture anchors (<xdr:pic>) inside
// xl/drawings/*.xml. Any other drawing shape — including the header's
// company-name/address <xdr:sp> text box — is silently dropped the moment a
// workbook loaded via workbook.xlsx.load() is re-serialized with
// workbook.xlsx.writeBuffer(), even though nothing in this codebase ever
// touches that shape directly. Confirmed by round-tripping the pristine
// template through ExcelJS with no other changes: the logo (<xdr:pic>)
// survives, the text box (<xdr:sp>) does not.
//
// Rather than replace the ExcelJS-based fill pipeline (removeUnusedSections /
// fillDynamicRows / replaceVariables all depend on its cell/row/merge APIs
// and work correctly), this patches the one part ExcelJS mangles: after
// writeBuffer() produces the final workbook, every xl/drawings/*.xml part is
// overwritten with the byte-identical part from the original template file.
// The relationship ids inside those files (rId1 -> image1.png) are unchanged
// by anything ExcelJS does, so this is a safe drop-in swap, not a rebuild.
import JSZip from "jszip";
import { readFile } from "fs/promises";
import path from "path";
import { TEMPLATE_CONFIG } from "./config";

export async function restoreTemplateDrawings(generatedBuffer: Buffer): Promise<Buffer> {
  const templatePath = path.join(/* turbopackIgnore: true */ process.cwd(), TEMPLATE_CONFIG.templateRelativePath);
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
