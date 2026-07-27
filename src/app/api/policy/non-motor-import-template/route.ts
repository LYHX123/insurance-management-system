import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { NON_MOTOR_STANDARD_HEADERS } from "@/lib/policy/nonMotorImportParser";

// Authenticated download of a blank standard-columns template for the
// Non-Motor historical import — generated in-code with exceljs (already a
// project dependency), not a static repository file, so it can never drift
// out of sync with nonMotorImportParser.ts's actual recognized columns.
export async function GET() {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "policy.non_motor")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Non-Motor Import");
  const headers = Object.values(NON_MOTOR_STANDARD_HEADERS);
  sheet.addRow(headers);
  sheet.getRow(1).font = { bold: true };
  sheet.columns = headers.map(() => ({ width: 20 }));

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="non-motor-import-template.xlsx"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
