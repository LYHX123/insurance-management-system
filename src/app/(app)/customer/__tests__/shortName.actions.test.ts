import { describe, it, expect, vi, beforeEach } from "vitest";

// Phase 4 Part 2/17.A: Customer Short Name flows through create/edit
// actions and is validated before any DB write.

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

type FakeCustomer = { id: string; customerNumber: string; companyName: string; pinNumber: string; shortName: string | null };
let customers: FakeCustomer[] = [];
let createCalls: Record<string, unknown>[] = [];
let updateCalls: Record<string, unknown>[] = [];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customer: {
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const found = customers.find((c) => c.id === where.id);
        return found ? { ...found } : null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        updateCalls.push(data);
        const c = customers.find((x) => x.id === where.id)!;
        Object.assign(c, data);
        return c;
      }),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => {
      const customerNumber = `CUST-${String(customers.length + 1).padStart(4, "0")}`;
      const tx = {
        $queryRaw: vi.fn(async () => [{ nextval: BigInt(customers.length + 1) }]),
        customer: {
          create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
            createCalls.push(data);
            const customer: FakeCustomer = {
              id: `cust-${customers.length + 1}`,
              customerNumber,
              companyName: data.companyName as string,
              pinNumber: data.pinNumber as string,
              shortName: (data.shortName as string | null) ?? null,
            };
            customers.push(customer);
            return customer;
          }),
        },
      };
      return cb(tx);
    }),
  },
}));

describe("Customer Short Name — create/edit actions (Phase 4 Part 2/17.A)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    customers = [];
    createCalls = [];
    updateCalls = [];
    auth.mockResolvedValue({ user: { id: "user-1", role: "Staff", status: "ACTIVE", permissions: ["customer"] } });
    syncCustomerFolder.mockResolvedValue({ success: true, status: "SYNCED" });
    renameCustomerFolder.mockResolvedValue({ success: true, status: "SYNCED" });
  });

  it("1. creates a Customer with a shortName", async () => {
    const { createCustomerAction } = await import("../actions");

    const result = await createCustomerAction({
      company: { companyName: "China Railway Seventh Group Co., Limited", pinNumber: "P123456789A", shortName: "CRSG" },
      projects: [],
    });

    expect(result.success).toBe(true);
    expect(createCalls[0].shortName).toBe("CRSG");
  });

  it("3. an existing Customer without shortName is created/stored fine (nullable)", async () => {
    const { createCustomerAction } = await import("../actions");

    const result = await createCustomerAction({
      company: { companyName: "Acme Ltd", pinNumber: "P123456789A" },
      projects: [],
    });

    expect(result.success).toBe(true);
    expect(createCalls[0].shortName).toBeNull();
  });

  it("8/9. rejects a shortName with path separators or control characters before any DB write", async () => {
    const { createCustomerAction } = await import("../actions");

    const result = await createCustomerAction({
      company: { companyName: "Acme Ltd", pinNumber: "P123456789A", shortName: "CRSG/2026" },
      projects: [],
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("SHORT_NAME_INVALID_CHARACTERS");
    expect(createCalls).toHaveLength(0);
  });

  it("2. edits an existing Customer's shortName", async () => {
    customers = [{ id: "cust-1", customerNumber: "CUST-0001", companyName: "Acme Ltd", pinNumber: "P123456789A", shortName: null }];
    const { updateCustomerAction } = await import("../actions");

    const result = await updateCustomerAction("cust-1", { companyName: "Acme Ltd", pinNumber: "P123456789A", shortName: "ACME" });

    expect(result.success).toBe(true);
    expect(updateCalls[0].shortName).toBe("ACME");
  });
});
