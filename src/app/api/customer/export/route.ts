import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { getLocale } from "@/i18n/get-locale";
import { dictionaries } from "@/i18n/config";
import { matchesCustomerListFilters } from "@/lib/customer/customerListFilter";
import { buildExportWorkbookBuffer, buildExportFilename, xlsxResponse } from "@/lib/excel/exportSheet";

// Phase 13A — authenticated Excel export of the Customer list. Re-applies the
// exact same search / status filter the list uses (see
// src/lib/customer/customerListFilter.ts) against the FULL customer set, so
// the file always matches what "Export Excel" was clicked from — never just
// a visible page. One row per Customer (the list already shows one row per
// Customer; mainContactPerson / mainPhoneNumber are scalar fields, so there
// is no contact fan-out to de-duplicate). Generated entirely in memory.

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "customer")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const params = req.nextUrl.searchParams;
  const search = params.get("search") ?? "";
  const status = params.get("status") ?? "ALL";
  const isFiltered = search.trim() !== "" || status !== "ALL";

  const locale = await getLocale();
  const t = dictionaries[locale];

  const customers = await prisma.customer.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      customerNumber: true,
      companyName: true,
      shortName: true,
      pinNumber: true,
      mainContactPerson: true,
      mainPhoneNumber: true,
      registeredAddress: true,
      status: true,
      createdAt: true,
    },
  });

  const filtered = customers.filter((c) => matchesCustomerListFilters(c, { search, status }));

  const statusLabel = (s: string) => (s === "ACTIVE" ? t.customers.active : t.customers.inactive);

  const buffer = await buildExportWorkbookBuffer({
    sheetName: t.customers.title,
    columns: [
      { header: t.customers.customerNumber, key: "customerNumber", width: 16 },
      { header: t.customers.companyName, key: "companyName", width: 34 },
      { header: t.customers.shortName, key: "shortName", width: 18 },
      { header: t.customers.pinNumber, key: "pinNumber", width: 18 },
      { header: t.customers.mainContactPerson, key: "contactPerson", width: 22 },
      { header: t.customers.mainPhoneNumber, key: "phone", width: 18 },
      { header: t.customers.registeredAddress, key: "address", width: 40 },
      { header: t.common.status, key: "status", width: 12 },
      { header: t.customers.createdDate, key: "createdDate", width: 14 },
    ],
    rows: filtered.map((c) => ({
      customerNumber: c.customerNumber,
      companyName: c.companyName,
      shortName: c.shortName ?? "",
      pinNumber: c.pinNumber,
      contactPerson: c.mainContactPerson ?? "",
      phone: c.mainPhoneNumber ?? "",
      address: c.registeredAddress ?? "",
      status: statusLabel(c.status),
      createdDate: c.createdAt.toISOString().slice(0, 10),
    })),
  });

  return xlsxResponse(buffer, buildExportFilename("Customers", isFiltered));
}
