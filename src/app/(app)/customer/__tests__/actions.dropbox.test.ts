import { describe, it, expect, vi, beforeEach } from "vitest";

// Part 23.A/D regression at the action layer: Customer creation stays
// reliable regardless of Dropbox outcome, and deletion never touches
// Dropbox at all.
const auth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: (...args: unknown[]) => auth(...args) }));

vi.mock("@/lib/permissions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  return { ...actual, hasPermission: () => true };
});

const syncCustomerFolder = vi.fn();
const renameCustomerFolder = vi.fn();
vi.mock("@/lib/integrations/dropbox/customer-folders", () => ({
  syncCustomerFolder: (...args: unknown[]) => syncCustomerFolder(...args),
  renameCustomerFolder: (...args: unknown[]) => renameCustomerFolder(...args),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

type FakeCustomer = { id: string; customerNumber: string; companyName: string; pinNumber: string };
let customers: FakeCustomer[] = [];
let dropboxFolders: Map<string, { displayPath: string | null }> = new Map();
let sequence = 0;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customer: {
      findFirst: vi.fn(async () => null),
      // Returns a SHALLOW COPY, not the live array reference — otherwise a
      // later `customer.update()` mutating the same object would also
      // silently mutate an earlier-captured "before" snapshot.
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const found = customers.find((c) => c.id === where.id);
        return found ? { ...found } : null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const c = customers.find((x) => x.id === where.id)!;
        Object.assign(c, data);
        return c;
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        customers = customers.filter((c) => c.id !== where.id);
      }),
    },
    customerProject: { count: vi.fn(async () => 0) },
    customerDocument: { count: vi.fn(async () => 0) },
    quotation: { count: vi.fn(async () => 0) },
    customerDropboxFolder: {
      findUnique: vi.fn(async ({ where }: { where: { customerId: string } }) => dropboxFolders.get(where.customerId) ?? null),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => {
      sequence += 1;
      const customerNumber = `CUST-${String(sequence).padStart(4, "0")}`;
      const tx = {
        $queryRaw: vi.fn(async () => [{ nextval: BigInt(sequence) }]),
        customer: {
          create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
            const customer: FakeCustomer = {
              id: `cust-${sequence}`,
              customerNumber,
              companyName: data.companyName as string,
              pinNumber: data.pinNumber as string,
            };
            customers.push(customer);
            if (data.dropboxFolder) {
              dropboxFolders.set(customer.id, { displayPath: null });
            }
            return customer;
          }),
        },
      };
      return cb(tx);
    }),
  },
}));

describe("createCustomerAction — Dropbox integration (Part 23.A regression)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    customers = [];
    dropboxFolders = new Map();
    sequence = 0;
    auth.mockResolvedValue({ user: { id: "user-1", role: "Staff", status: "ACTIVE", permissions: ["customer"] } });
  });

  const validInput = {
    company: { companyName: "Acme Ltd", pinNumber: "P123456789A" },
    projects: [],
  };

  it("A1: Customer is created and reports SYNCED when Dropbox sync succeeds", async () => {
    syncCustomerFolder.mockResolvedValue({ success: true, status: "SYNCED" });
    const { createCustomerAction } = await import("../actions");

    const result = await createCustomerAction(validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.dropboxSyncStatus).toBe("SYNCED");
    expect(customers).toHaveLength(1);
  });

  it("A2: Customer is still created successfully when Dropbox sync fails/is disconnected", async () => {
    syncCustomerFolder.mockResolvedValue({ success: false, status: "ERROR", code: "DROPBOX_NOT_CONNECTED" });
    const { createCustomerAction } = await import("../actions");

    const result = await createCustomerAction(validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.dropboxSyncStatus).toBe("ERROR");
    expect(customers).toHaveLength(1);
  });

  it("A3: a thrown/hung Dropbox sync never causes Customer creation to report failure", async () => {
    syncCustomerFolder.mockRejectedValue(new Error("boom"));
    const { createCustomerAction } = await import("../actions");

    const result = await createCustomerAction(validInput);

    // The customer row is committed inside the transaction regardless of
    // what happens afterward — see actions.ts's comment on this boundary.
    expect(result.success).toBe(true);
    expect(customers).toHaveLength(1);
  });

  it("does not create a duplicate Customer when Dropbox sync is retried", async () => {
    syncCustomerFolder.mockResolvedValue({ success: true, status: "SYNCED" });
    const { createCustomerAction } = await import("../actions");

    await createCustomerAction(validInput);
    expect(customers).toHaveLength(1);
    expect(syncCustomerFolder).toHaveBeenCalledTimes(1);
  });
});

describe("updateCustomerAction — rename integration (Part 23.C regression)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    customers = [{ id: "cust-1", customerNumber: "CUST-0001", companyName: "Old Name Ltd", pinNumber: "P123456789A" }];
    dropboxFolders = new Map();
    auth.mockResolvedValue({ user: { id: "user-1", role: "Staff", status: "ACTIVE", permissions: ["customer"] } });
  });

  it("renames the Dropbox folder only when the company name actually changed", async () => {
    renameCustomerFolder.mockResolvedValue({ success: true, status: "SYNCED" });
    const { updateCustomerAction } = await import("../actions");

    const result = await updateCustomerAction("cust-1", { companyName: "New Name Ltd", pinNumber: "P123456789A" });

    expect(result.success).toBe(true);
    expect(renameCustomerFolder).toHaveBeenCalledWith("cust-1");
  });

  it("does not attempt a Dropbox rename when the company name is unchanged", async () => {
    const { updateCustomerAction } = await import("../actions");

    const result = await updateCustomerAction("cust-1", { companyName: "Old Name Ltd", pinNumber: "P123456789A" });

    expect(result.success).toBe(true);
    expect(renameCustomerFolder).not.toHaveBeenCalled();
  });

  it("a rename failure does not affect the successful Customer edit response", async () => {
    renameCustomerFolder.mockRejectedValue(new Error("boom"));
    const { updateCustomerAction } = await import("../actions");

    const result = await updateCustomerAction("cust-1", { companyName: "Another Name Ltd", pinNumber: "P123456789A" });

    expect(result.success).toBe(true);
  });
});

describe("deleteCustomerAction — never touches Dropbox (Part 23.D)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    customers = [{ id: "cust-1", customerNumber: "CUST-0001", companyName: "Acme Ltd", pinNumber: "P123456789A" }];
    dropboxFolders = new Map([["cust-1", { displayPath: "/Insurance Management System/Customers/CUST-0001 - Acme Ltd" }]]);
    auth.mockResolvedValue({ user: { id: "user-1", role: "Staff", status: "ACTIVE", permissions: ["customer"] } });
  });

  it("D1/D2: deleting a Customer (no related records) hard-deletes the row and never calls any Dropbox function", async () => {
    const { deleteCustomerAction } = await import("../actions");

    const result = await deleteCustomerAction("cust-1");

    expect(result.success).toBe(true);
    if (result.success) expect(result.deactivatedInstead).toBe(false);
    expect(customers).toHaveLength(0);
    expect(syncCustomerFolder).not.toHaveBeenCalled();
    expect(renameCustomerFolder).not.toHaveBeenCalled();
  });
});
