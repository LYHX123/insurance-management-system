import { describe, it, expect } from "vitest";
import { toIntegrationView } from "../service";
import type { DropboxIntegrationModel } from "@/generated/prisma/models";

describe("toIntegrationView — no secrets ever reach the client (Part 20.G)", () => {
  const row = {
    id: "singleton",
    status: "CONNECTED",
    encryptedRefreshToken: "v1:dummy-iv:dummy-tag:dummy-ciphertext",
    dropboxAccountId: "dbid:dummy",
    accountEmail: "tester@example.com",
    accountDisplayName: "Test User",
    rootFolder: "/Insurance Management System",
    rootFolderVerifiedAt: new Date(),
    connectedAt: new Date(),
    disconnectedAt: null,
    lastTestedAt: new Date(),
    lastSuccessfulAt: new Date(),
    lastErrorCode: null,
    lastErrorMessage: null,
    connectedById: "admin-1",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as DropboxIntegrationModel;

  it("never includes encryptedRefreshToken in the client-facing view", () => {
    const view = toIntegrationView(row, "Test Admin", false);
    expect(JSON.stringify(view)).not.toContain("dummy-ciphertext");
    expect("encryptedRefreshToken" in view).toBe(false);
  });

  it("reports status ERROR and a safe message when configuration is missing, regardless of stored status", () => {
    const view = toIntegrationView(row, "Test Admin", true);
    expect(view.status).toBe("ERROR");
    expect(view.lastErrorCode).toBe("CONFIGURATION_MISSING");
  });

  it("passes through the connected-by display name resolved server-side, not a raw user id", () => {
    const view = toIntegrationView(row, "Test Admin", false);
    expect(view.connectedByName).toBe("Test Admin");
  });
});
