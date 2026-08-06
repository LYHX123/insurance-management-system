import { describe, it, expect, vi, beforeEach } from "vitest";
import bcrypt from "bcryptjs";

// Extracted from src/lib/auth.ts's authorize() (Production Readiness Audit
// V1, finding H3) — proves the core login logic directly, independent of
// the rate limiter and of NextAuth's own initialization.

type UserRow = {
  id: string;
  username: string;
  fullName: string;
  passwordHash: string;
  role: string;
  status: string;
  preferredLanguage: string;
  permissions: string[];
};

let users: UserRow[];
const updateMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        if ("fullName" in where) {
          const clause = where.fullName as { equals: string; mode: string };
          return users.find((u) => u.fullName.toLowerCase() === clause.equals.toLowerCase()) ?? null;
        }
        if ("username" in where) {
          const clause = where.username as { equals: string; mode: string };
          return users.find((u) => u.username.toLowerCase() === clause.equals.toLowerCase()) ?? null;
        }
        return null;
      }),
      update: (...args: unknown[]) => updateMock(...args),
    },
  },
}));

const REAL_PASSWORD = "correct horse battery staple";
let realHash: string;

describe("verifyCredentials", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    realHash = await bcrypt.hash(REAL_PASSWORD, 4); // low cost factor — tests only
    users = [
      {
        id: "user-1",
        username: "admin",
        fullName: "Jane Doe",
        passwordHash: realHash,
        role: "Staff",
        status: "ACTIVE",
        preferredLanguage: "en",
        permissions: ["customer.view"],
      },
      {
        id: "user-2",
        username: "olduser",
        fullName: "Disabled Person",
        passwordHash: realHash,
        role: "Staff",
        status: "DISABLED",
        preferredLanguage: "en",
        permissions: [],
      },
    ];
    updateMock.mockResolvedValue({});
  });

  it("1. correct Full Name + correct password -> returns the user", async () => {
    const { verifyCredentials } = await import("../credentials");
    const result = await verifyCredentials("Jane Doe", REAL_PASSWORD);
    expect(result).not.toBeNull();
    expect(result?.id).toBe("user-1");
    expect(updateMock).toHaveBeenCalledWith({ where: { id: "user-1" }, data: { lastLoginAt: expect.any(Date) } });
  });

  it("Full Name match is case-insensitive and trims surrounding whitespace at the call site", async () => {
    const { verifyCredentials } = await import("../credentials");
    const result = await verifyCredentials("jane doe", REAL_PASSWORD);
    expect(result?.id).toBe("user-1");
  });

  it("legacy username still works for accounts migrated from username+password login", async () => {
    const { verifyCredentials } = await import("../credentials");
    const result = await verifyCredentials("admin", REAL_PASSWORD);
    expect(result?.id).toBe("user-1");
  });

  it("2. wrong password -> null", async () => {
    const { verifyCredentials } = await import("../credentials");
    const result = await verifyCredentials("Jane Doe", "wrong-password");
    expect(result).toBeNull();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("3. a login identifier that matches no user -> null, same shape as a wrong password", async () => {
    const { verifyCredentials } = await import("../credentials");
    const notFound = await verifyCredentials("Nobody Here", REAL_PASSWORD);
    const wrongPassword = await verifyCredentials("Jane Doe", "wrong-password");
    expect(notFound).toBeNull();
    expect(wrongPassword).toBeNull();
    expect(notFound).toEqual(wrongPassword); // both are simply `null` — indistinguishable to the caller
  });

  it("a DISABLED account is rejected even with the correct password", async () => {
    const { verifyCredentials } = await import("../credentials");
    const result = await verifyCredentials("Disabled Person", REAL_PASSWORD);
    expect(result).toBeNull();
    expect(updateMock).not.toHaveBeenCalled();
  });
});
