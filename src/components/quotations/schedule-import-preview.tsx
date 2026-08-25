"use client";

import { useLocale } from "@/i18n/locale-provider";
import { Badge } from "@/components/ui/badge";
import { TableWrap, Table } from "@/components/ui/table";
import { formatMoney } from "@/components/ui/money-input";
import type { WibaScheduleRow, WibaScheduleTotals, WibaRowErrorCode, CpmScheduleRow, CpmScheduleTotals, CpmRowErrorCode } from "@/lib/quotationScheduleImport/types";
import type { Dictionary } from "@/i18n/dictionaries/en";

// Phase 9 — WIBA / CPM Schedule Import. Pure presentational preview tables:
// every number shown here is already the system-recalculated value the
// parser produced (src/lib/quotationScheduleImport/{wibaParser,cpmParser}.ts)
// — never re-derived here, and never the workbook's own formula result.

function wibaRowErrorMessage(code: WibaRowErrorCode, t: Dictionary): string {
  switch (code) {
    case "OCCUPATION_REQUIRED":
      return t.quotations.scheduleErrorOccupationRequired;
    case "OCCUPATION_TOO_LONG":
      return t.quotations.scheduleErrorOccupationTooLong;
    case "BASIC_SALARY_INVALID":
      return t.quotations.scheduleErrorBasicSalaryInvalid;
    case "ALLOWANCE_INVALID":
      return t.quotations.scheduleErrorAllowanceInvalid;
    case "OTHER_EARNINGS_INVALID":
      return t.quotations.scheduleErrorOtherEarningsInvalid;
    case "EMPLOYEE_COUNT_INVALID":
      return t.quotations.scheduleErrorEmployeeCountInvalid;
  }
}

function cpmRowErrorMessage(code: CpmRowErrorCode, t: Dictionary): string {
  switch (code) {
    case "EQUIPMENT_NAME_REQUIRED":
      return t.quotations.scheduleErrorEquipmentNameRequired;
    case "EQUIPMENT_NAME_TOO_LONG":
      return t.quotations.scheduleErrorEquipmentNameTooLong;
    case "QUANTITY_INVALID":
      return t.quotations.scheduleErrorQuantityInvalid;
    case "UNIT_VALUE_INVALID":
      return t.quotations.scheduleErrorUnitValueInvalid;
  }
}

function rowLabel(rowNumber: number, t: Dictionary): string {
  const suffix = t.quotations.scheduleRowLabelSuffix ? ` ${t.quotations.scheduleRowLabelSuffix}` : "";
  return `${t.quotations.scheduleRowLabel} ${rowNumber}${suffix}`;
}

function StatusBadge({ status, t }: { status: "valid" | "error"; t: Dictionary }) {
  return status === "valid" ? (
    <Badge tone="success">{t.quotations.scheduleRowStatusValid}</Badge>
  ) : (
    <Badge tone="danger">{t.quotations.scheduleRowStatusError}</Badge>
  );
}

export function WibaSchedulePreview({ rows, totals }: { rows: WibaScheduleRow[]; totals: WibaScheduleTotals }) {
  const { t } = useLocale();
  return (
    <div className="flex flex-col gap-3">
      <TableWrap scroll>
        <Table className="min-w-[900px]">
          <thead>
            <tr>
              <th>No</th>
              <th>{t.quotations.occupation}</th>
              <th>{t.quotations.basicMonthlySalary}</th>
              <th>{t.quotations.monthlyAllowance}</th>
              <th>{t.quotations.monthlyOtherEarnings}</th>
              <th>{t.quotations.employeeCount}</th>
              <th>{t.quotations.wibaMonthlyEarnings}</th>
              <th>{t.quotations.wibaAnnualEarnings}</th>
              <th>{t.common.status}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.rowNumber} className={row.status === "error" ? "bg-red-50/60" : ""}>
                <td className="text-zinc-500">{row.rowNumber - 1}</td>
                <td>{row.occupation || "—"}</td>
                <td className="text-zinc-500">{row.basicSalary ? formatMoney(Number(row.basicSalary)) : "—"}</td>
                <td className="text-zinc-500">{row.allowance ? formatMoney(Number(row.allowance)) : "—"}</td>
                <td className="text-zinc-500">{row.otherEarnings ? formatMoney(Number(row.otherEarnings)) : "—"}</td>
                <td className="text-zinc-500">{row.employeeCount || "—"}</td>
                <td className="text-zinc-500">{row.status === "valid" ? formatMoney(Number(row.monthlyEarnings)) : "—"}</td>
                <td className="text-zinc-500">{row.status === "valid" ? formatMoney(Number(row.annualEarnings)) : "—"}</td>
                <td><StatusBadge status={row.status} t={t} /></td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      {rows.some((r) => r.status === "error") && (
        <ul className="flex flex-col gap-1 rounded-control bg-red-50 p-3 text-sm text-red-700">
          {rows
            .filter((r) => r.status === "error" && r.errorCode)
            .map((r) => (
              <li key={r.rowNumber}>
                {rowLabel(r.rowNumber - 1, t)} — {wibaRowErrorMessage(r.errorCode!, t)}
              </li>
            ))}
        </ul>
      )}

      <div className="grid grid-cols-3 gap-2 rounded-control bg-zinc-50 p-3 text-sm">
        <div>
          <div className="text-secondary">{t.quotations.scheduleTotalEmployees}</div>
          <div className="font-medium text-zinc-800">{totals.totalEmployees}</div>
        </div>
        <div>
          <div className="text-secondary">{t.quotations.scheduleTotalMonthlyEarnings}</div>
          <div className="font-medium text-zinc-800">{formatMoney(totals.totalMonthlyEarnings)}</div>
        </div>
        <div>
          <div className="text-secondary">{t.quotations.scheduleTotalAnnualEarnings}</div>
          <div className="font-semibold text-emerald-800">{formatMoney(totals.totalAnnualEarnings)}</div>
        </div>
      </div>
    </div>
  );
}

export function CpmSchedulePreview({ rows, totals }: { rows: CpmScheduleRow[]; totals: CpmScheduleTotals }) {
  const { t } = useLocale();
  return (
    <div className="flex flex-col gap-3">
      <TableWrap scroll>
        <Table className="min-w-[900px]">
          <thead>
            <tr>
              <th>No</th>
              <th>{t.quotations.equipmentName}</th>
              <th>{t.quotations.chassisOrPlate}</th>
              <th>{t.quotations.quantity}</th>
              <th>{t.quotations.unitValue}</th>
              <th>{t.quotations.totalValue}</th>
              <th>{t.common.status}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.rowNumber} className={row.status === "error" ? "bg-red-50/60" : ""}>
                <td className="text-zinc-500">{row.rowNumber - 1}</td>
                <td>{row.equipmentName || "—"}</td>
                <td className="text-zinc-500">{row.chassisOrPlate || "—"}</td>
                <td className="text-zinc-500">{row.quantity || "—"}</td>
                <td className="text-zinc-500">{row.unitValue ? formatMoney(Number(row.unitValue)) : "—"}</td>
                <td className="text-zinc-500">{row.status === "valid" ? formatMoney(Number(row.totalValue)) : "—"}</td>
                <td><StatusBadge status={row.status} t={t} /></td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      {rows.some((r) => r.status === "error") && (
        <ul className="flex flex-col gap-1 rounded-control bg-red-50 p-3 text-sm text-red-700">
          {rows
            .filter((r) => r.status === "error" && r.errorCode)
            .map((r) => (
              <li key={r.rowNumber}>
                {rowLabel(r.rowNumber - 1, t)} — {cpmRowErrorMessage(r.errorCode!, t)}
              </li>
            ))}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-2 rounded-control bg-zinc-50 p-3 text-sm">
        <div>
          <div className="text-secondary">{t.quotations.scheduleTotalQuantity}</div>
          <div className="font-medium text-zinc-800">{totals.totalQuantity}</div>
        </div>
        <div>
          <div className="text-secondary">{t.quotations.cpmTotalSumInsured}</div>
          <div className="font-semibold text-emerald-800">{formatMoney(totals.totalSumInsured)}</div>
        </div>
      </div>
    </div>
  );
}
