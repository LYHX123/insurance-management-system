import { describe, it, expect, afterEach } from "vitest";

// Part 2 of this feature's spec: the flag must be the EXACT string "true" —
// every other value (unset, "false", "TRUE", "1", "yes", trailing
// whitespace, ...) is treated as disabled.

describe("isProductionInitializationEnabled", () => {
  const original = process.env.ENABLE_PRODUCTION_INITIALIZATION;

  afterEach(() => {
    if (original === undefined) delete process.env.ENABLE_PRODUCTION_INITIALIZATION;
    else process.env.ENABLE_PRODUCTION_INITIALIZATION = original;
  });

  async function isEnabled(): Promise<boolean> {
    // Re-import so the function re-reads process.env fresh each time —
    // vitest module cache would otherwise not matter here since the check
    // happens inside the function body (not at import time), but this
    // keeps the test explicit about that.
    const { isProductionInitializationEnabled } = await import("../constants");
    return isProductionInitializationEnabled();
  }

  it("is disabled when unset", async () => {
    delete process.env.ENABLE_PRODUCTION_INITIALIZATION;
    expect(await isEnabled()).toBe(false);
  });

  it("is enabled only for the exact string 'true'", async () => {
    process.env.ENABLE_PRODUCTION_INITIALIZATION = "true";
    expect(await isEnabled()).toBe(true);
  });

  it.each(["false", "TRUE", "True", "1", "yes", "true ", " true", "truex"])("is disabled for %j", async (value) => {
    process.env.ENABLE_PRODUCTION_INITIALIZATION = value;
    expect(await isEnabled()).toBe(false);
  });
});

describe("CONFIRMATION_TEXT", () => {
  it("is the exact required phrase", async () => {
    const { CONFIRMATION_TEXT } = await import("../constants");
    expect(CONFIRMATION_TEXT).toBe("INITIALIZE SYSTEM");
  });
});
