import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Phase: Production Initialization — source-structure guardrails (this
// project's vitest config is node-only, no React Testing Library/jsdom, see
// e.g. src/components/policy/__tests__/documentTableLayout.test.ts for the
// established convention of asserting on source text instead).
const panelSource = readFileSync(join(__dirname, "..", "production-initialization-panel.tsx"), "utf8");
const settingsContentSource = readFileSync(join(__dirname, "..", "settings-content.tsx"), "utf8");
const pageSource = readFileSync(join(__dirname, "..", "..", "..", "app", "(app)", "settings", "page.tsx"), "utf8");

describe("Production Initialization — entry point visibility (scenario 1)", () => {
  it("settings-content only renders the panel when productionInit is non-null", () => {
    expect(settingsContentSource).toMatch(/\{productionInit\s*&&\s*<ProductionInitializationPanel/);
  });

  it("the Settings page computes productionInit as null when the feature flag is disabled, never rendering the panel with a fake enabled state", () => {
    expect(pageSource).toMatch(/isProductionInitializationEnabled\(\)/);
    expect(pageSource).toMatch(/productionInitEnabled\s*\?\s*await getProductionInitializationStatus\(\)\s*:\s*null/);
  });

  it("the raw env var is never READ (as code, outside comments) in the client panel component", () => {
    const codeOnly = panelSource
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(codeOnly).not.toMatch(/process\.env/);
  });
});

describe("Production Initialization — confirmation text strictness (scenarios 9-11)", () => {
  it("compares the typed confirmation text with strict === against CONFIRMATION_TEXT, never .trim()", () => {
    expect(panelSource).toMatch(/typedText\s*===\s*CONFIRMATION_TEXT/);
    expect(panelSource).not.toMatch(/typedText\.trim\(\)/);
  });

  it("does not reuse TypedConfirmDialog (which trims before comparing) for the final confirmation step", () => {
    expect(panelSource).not.toMatch(/TypedConfirmDialog/);
  });
});

describe("Production Initialization — submit gating (backup checkbox + reason + preview loaded)", () => {
  it("canSubmit requires backupConfirmed, exact text match, a selected reason, and a successfully loaded preview", () => {
    expect(panelSource).toMatch(/backupConfirmed\s*&&\s*typedText\s*===\s*CONFIRMATION_TEXT\s*&&\s*reason\s*!==\s*""\s*&&\s*!!preview\s*&&\s*!previewLoading/);
  });

  it("the final destructive button is disabled unless canSubmit is true", () => {
    expect(panelSource).toMatch(/disabled=\{!canSubmit \|\| executing\}/);
  });

  it("openConfirmModal resets reason to empty (must be re-selected every time, never sticky across runs)", () => {
    expect(panelSource).toMatch(/setReason\(""\)/);
  });
});

describe("Production Initialization — reason selection (whitelist-only)", () => {
  it("renders exactly the four allowed reason options from PRODUCTION_INIT_REASONS, no free-text input", () => {
    expect(panelSource).toMatch(/PRODUCTION_INIT_REASONS\.map/);
    expect(panelSource).not.toMatch(/<Input[^>]*reason/i);
  });

  it("sends reason in the execute POST body", () => {
    expect(panelSource).toMatch(/JSON\.stringify\(\{\s*confirmationText:\s*typedText,\s*backupConfirmed,\s*reason\s*\}\)/);
  });

  it("maps INVALID_REASON to a localized error message", () => {
    expect(panelSource).toMatch(/INVALID_REASON:\s*t\.productionInit\.errorInvalidReason/);
  });

  it("shows 'Not recorded' for a past run with a null reason, never a blank cell", () => {
    expect(panelSource).toMatch(/reasonNotRecorded/);
  });
});

describe("Production Initialization — cannot close the confirm modal while executing (Part 8)", () => {
  it("closeConfirmModal is a no-op while a request is in flight", () => {
    expect(panelSource).toMatch(/const closeConfirmModal = \(\) => \{\s*\n\s*if \(executing\) return;/);
  });
});

describe("Production Initialization — Preview is refreshed immediately before showing the confirm step (Part 6)", () => {
  it("openConfirmModal fetches the preview endpoint", () => {
    expect(panelSource).toMatch(/fetch\("\/api\/settings\/production-initialization\/preview"\)/);
  });
});

describe("Production Initialization — success handling clears cache", () => {
  it("calls router.refresh() after a successful execute", () => {
    expect(panelSource).toMatch(/router\.refresh\(\)/);
  });

  it("never calls any Dropbox disconnect action (Dropbox connection must survive)", () => {
    expect(panelSource).not.toMatch(/disconnectDropbox/);
  });
});

describe("Production Initialization — forced logout after success (Part 1)", () => {
  it("uses the app's real next-auth signOut, the same one the Topbar uses — never a bare router.push('/login')", () => {
    expect(panelSource).toMatch(/import\s*\{\s*signOut,\s*getSession\s*\}\s*from\s*"next-auth\/react"/);
    expect(panelSource).toMatch(/await signOut\(\{ redirect: false \}\)/);
  });

  it("verifies the session is actually gone (via getSession) before navigating away", () => {
    expect(panelSource).toMatch(/const session = await getSession\(\);/);
    expect(panelSource).toMatch(/if \(session\) throw new Error/);
  });

  it("navigates with a full page replace, never SPA client-side routing, so Back cannot restore the old authenticated view", () => {
    expect(panelSource).toMatch(/window\.location\.replace\("\/login"\)/);
    // The logout success path must not use router.push for the final navigation.
    const afterGetSession = panelSource.slice(panelSource.indexOf("const handleContinueToLogin"));
    expect(afterGetSession).not.toMatch(/router\.push\("\/login"\)/);
  });

  it("the 'Continue to Login' button only exists inside the executeResult-gated success card — logout is unreachable before SUCCESS", () => {
    const successCardStart = panelSource.indexOf("{executeResult && (");
    const successCardEnd = panelSource.indexOf("{blocked && (");
    expect(successCardStart).toBeGreaterThan(-1);
    const successCard = panelSource.slice(successCardStart, successCardEnd);
    expect(successCard).toMatch(/onClick=\{handleContinueToLogin\}/);
    expect(successCard).toMatch(/t\.productionInit\.continueToLogin/);
  });

  it("a failed logout shows a manual-logout notice and does not retry or alter the initialization result", () => {
    expect(panelSource).toMatch(/setLoggingOut\(false\);\s*\n\s*setLogoutFailed\(true\);/);
    expect(panelSource).toMatch(/\{logoutFailed && <p[^>]*>\{t\.productionInit\.logoutFailedNotice\}<\/p>\}/);
    // The catch block must never touch executeResult/executeError.
    const handlerSource = panelSource.slice(panelSource.indexOf("const handleContinueToLogin"), panelSource.indexOf("return (", panelSource.indexOf("const handleContinueToLogin")));
    expect(handlerSource).not.toMatch(/setExecuteResult|setExecuteError/);
  });
});
