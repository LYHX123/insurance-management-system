import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getSystemLedgerRecords } from "@/lib/ledger/systemRecords";
import { SystemLedgerTable } from "@/components/ledger/system-ledger-table";

export default async function LedgerSystemPage() {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "ledger.system_record")) {
    redirect("/access-denied");
  }

  // Every user with Ledger access already has Policy-wide visibility in this
  // app's current permission model (there is no per-customer/per-policy
  // restriction anywhere else in the codebase) — see this phase's research
  // notes on src/lib/permissions.ts. System Records therefore shows every
  // qualifying source transaction, the same way every existing Policy list
  // page already does.
  const records = await getSystemLedgerRecords();

  return <SystemLedgerTable records={records} />;
}
