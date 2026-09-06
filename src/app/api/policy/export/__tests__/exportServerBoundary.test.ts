import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, statSync } from "fs";
import { join, dirname, resolve } from "path";

// Phase 13A regression — the Motor export returned HTTP 500 in the browser
// with:
//   "Attempted to call matchesOutstandingBalanceFilters() from the server
//    but matchesOutstandingBalanceFilters is on the client."
// because src/lib/policy/policyListView.ts (run by the server export route)
// imported that pure helper from src/components/policy/policy-list-outstanding-filters.tsx,
// a "use client" module. vitest does not enforce the RSC client/server
// boundary, so the existing integration tests passed anyway — this static
// check is what actually guards it.
//
// Rule: nothing transitively (value-)imported by an export route may be a
// "use client" module.

const SRC = resolve(__dirname, "..", "..", "..", "..", "..", "..", "src");

function resolveImport(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null; // node_modules — not our concern
  for (const cand of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx"), base]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

function isUseClient(file: string): boolean {
  const head = readFileSync(file, "utf8").slice(0, 400);
  return /^\s*(["'])use client\1/m.test(head.split("\n").slice(0, 3).join("\n"));
}

// value imports only (skip `import type { ... }` and `import { type X }` — but
// keep it simple: also follow mixed imports, which is safe/conservative).
function valueImports(src: string): string[] {
  const out: string[] = [];
  const re = /import\s+(?!type\s)(?:[^"']*?\sfrom\s)?["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

function assertNoClientInGraph(entry: string) {
  const visited = new Set<string>();
  const stack: Array<{ file: string; chain: string[] }> = [{ file: entry, chain: [entry] }];
  while (stack.length) {
    const { file, chain } = stack.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const src = readFileSync(file, "utf8");
    if (file !== entry && isUseClient(file)) {
      throw new Error(`server export graph pulls in a "use client" module:\n  ${chain.join("\n  -> ")}`);
    }
    for (const spec of valueImports(src)) {
      const resolved = resolveImport(file, spec);
      if (resolved && resolved.startsWith(SRC) && !visited.has(resolved)) {
        stack.push({ file: resolved, chain: [...chain, resolved] });
      }
    }
  }
}

describe("Phase 13A — export routes are server-clean", () => {
  it("the policy export route's import graph contains no 'use client' module", () => {
    expect(() => assertNoClientInGraph(join(SRC, "app/api/policy/export/[category]/route.ts"))).not.toThrow();
  });

  it("the customer export route's import graph contains no 'use client' module", () => {
    expect(() => assertNoClientInGraph(join(SRC, "app/api/customer/export/route.ts"))).not.toThrow();
  });

  it("policyListView imports the outstanding-balance helper from the framework-free module", () => {
    const s = readFileSync(join(SRC, "lib/policy/policyListView.ts"), "utf8");
    expect(s).toMatch(/import \{ matchesOutstandingBalanceFilters \} from "@\/lib\/policy\/outstandingBalanceFilter"/);
    expect(s).not.toMatch(/from "@\/components\/policy\/policy-list-outstanding-filters"/);
  });
});
