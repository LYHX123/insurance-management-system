import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync, utimesSync, existsSync, readdirSync } from "fs";
import { tmpdir } from "os";
import path from "path";

// Production Readiness Audit V1, finding H7. These tests never connect to
// any database (production or local dev) — they only exercise the shell
// scripts' own logic (argument validation, BACKUP_DIR safety, filename
// pattern, retention/rotation) via DRY_RUN=1, per the audit's explicit
// constraint that this phase's testing stay static/dry-run only (§28: "不能
//连接生产数据库... bash -n / dry-run / 参数校验测试 / BACKUP_DIR安全测试 /
// rotation匹配测试"). scripts/verify-backup.sh's real pg_restore path (which
// does need Docker) was exercised manually against the local dev database
// only — see docs/BACKUP_AND_RESTORE.md §9 — not by this automated suite.

const REPO_ROOT = process.cwd();
const BACKUP_SCRIPT = path.join(REPO_ROOT, "scripts", "backup-production-db.sh");
const VERIFY_SCRIPT = path.join(REPO_ROOT, "scripts", "verify-backup.sh");

// Node (a native Windows process) and the bash script (running under
// Git Bash/MSYS) disagree on path syntax: Node's fs module needs
// `C:\Users\...`, while bash needs the MSYS-translated `/c/Users/...` form
// to recognize it as absolute. This only matters for this test harness on
// Windows — the script itself targets a Linux production host, where paths
// are POSIX already and no translation is needed. A no-op on POSIX systems.
function toBashPath(p: string): string {
  const match = /^([A-Za-z]):(.*)$/.exec(p);
  if (!match) return p.replace(/\\/g, "/");
  return `/${match[1].toLowerCase()}${match[2].replace(/\\/g, "/")}`;
}

function runBackupScript(env: Record<string, string>): { status: number; stdout: string; stderr: string } {
  const translatedEnv = { ...env };
  if (translatedEnv.BACKUP_DIR && /^[A-Za-z]:/.test(translatedEnv.BACKUP_DIR)) {
    translatedEnv.BACKUP_DIR = toBashPath(translatedEnv.BACKUP_DIR);
  }
  try {
    const stdout = execFileSync("bash", [BACKUP_SCRIPT], {
      env: { ...process.env, ...translatedEnv },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { status: e.status, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

function runVerifyScript(args: string[]): { status: number; stdout: string; stderr: string } {
  const translatedArgs = args.map((a) => (/^[A-Za-z]:/.test(a) ? toBashPath(a) : a));
  try {
    const stdout = execFileSync("bash", [VERIFY_SCRIPT, ...translatedArgs], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { status: e.status, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

describe("scripts/backup-production-db.sh and verify-backup.sh — syntax", () => {
  it("backup-production-db.sh has valid bash syntax", () => {
    expect(() => execFileSync("bash", ["-n", BACKUP_SCRIPT], { stdio: "pipe" })).not.toThrow();
  });

  it("verify-backup.sh has valid bash syntax", () => {
    expect(() => execFileSync("bash", ["-n", VERIFY_SCRIPT], { stdio: "pipe" })).not.toThrow();
  });
});

describe("backup-production-db.sh — BACKUP_DIR safety (fail closed)", () => {
  it("refuses to run when BACKUP_DIR is unset/empty", () => {
    const result = runBackupScript({ BACKUP_DIR: "", DRY_RUN: "1" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/BACKUP_DIR is not set/);
  });

  it("refuses to run when BACKUP_DIR is '/'", () => {
    const result = runBackupScript({ BACKUP_DIR: "/", DRY_RUN: "1" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Refusing to operate on the filesystem root/);
  });

  it("refuses a relative BACKUP_DIR", () => {
    const result = runBackupScript({ BACKUP_DIR: "relative/path", DRY_RUN: "1" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/must be an absolute path/);
  });
});

describe("backup-production-db.sh — DRY_RUN end-to-end", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "insurance-backup-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates BACKUP_DIR if it doesn't exist yet, and writes a correctly-named file", () => {
    const target = path.join(dir, "does-not-exist-yet");
    const result = runBackupScript({ BACKUP_DIR: target, DRY_RUN: "1" });

    expect(result.status).toBe(0);
    expect(existsSync(target)).toBe(true);
    const files = readdirSync(target);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^insurance_system_\d{8}_\d{6}\.dump$/);
  });

  it("skips docker/pg_dump and verification entirely under DRY_RUN, and reports success", () => {
    const result = runBackupScript({ BACKUP_DIR: dir, DRY_RUN: "1" });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/DRY RUN: writing placeholder file/);
    expect(result.stdout).toMatch(/DRY RUN: skipping pg_restore --list verification/);
    expect(result.stdout).toMatch(/Backup complete/);
  });

  it("rotation deletes only files matching our own naming pattern that are older than RETENTION_DAYS, never anything else", () => {
    const oldBackup = path.join(dir, "insurance_system_20200101_000000.dump");
    const unrelatedOldFile = path.join(dir, "some_other_file.txt");
    writeFileSync(oldBackup, "old dump content");
    writeFileSync(unrelatedOldFile, "not a backup, must survive");
    const longAgo = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000); // ~400 days ago
    utimesSync(oldBackup, longAgo, longAgo);
    utimesSync(unrelatedOldFile, longAgo, longAgo);

    const result = runBackupScript({ BACKUP_DIR: dir, DRY_RUN: "1", RETENTION_DAYS: "30" });

    expect(result.status).toBe(0);
    const filesAfter = readdirSync(dir);
    expect(filesAfter).not.toContain("insurance_system_20200101_000000.dump");
    expect(filesAfter).toContain("some_other_file.txt"); // never touched — doesn't match our pattern
    expect(filesAfter.some((f) => /^insurance_system_\d{8}_\d{6}\.dump$/.test(f) && f !== "insurance_system_20200101_000000.dump")).toBe(
      true
    ); // this run's own fresh dump is present
  });

  it("a recent backup file (within RETENTION_DAYS) is NOT deleted by rotation", () => {
    const recentBackup = path.join(dir, "insurance_system_20260101_000000.dump");
    writeFileSync(recentBackup, "recent dump content");
    const yesterday = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    utimesSync(recentBackup, yesterday, yesterday);

    runBackupScript({ BACKUP_DIR: dir, DRY_RUN: "1", RETENTION_DAYS: "30" });

    expect(readdirSync(dir)).toContain("insurance_system_20260101_000000.dump");
  });

  it("SKIP_ROTATION=1 leaves old matching backups untouched", () => {
    const oldBackup = path.join(dir, "insurance_system_20200101_000000.dump");
    writeFileSync(oldBackup, "old dump content");
    const longAgo = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    utimesSync(oldBackup, longAgo, longAgo);

    const result = runBackupScript({ BACKUP_DIR: dir, DRY_RUN: "1", SKIP_ROTATION: "1" });

    expect(result.status).toBe(0);
    expect(readdirSync(dir)).toContain("insurance_system_20200101_000000.dump");
  });

  it("never writes a database password anywhere in stdout/stderr", () => {
    const result = runBackupScript({ BACKUP_DIR: dir, DRY_RUN: "1", POSTGRES_PASSWORD: "super-secret-value-should-never-appear" });
    expect(result.stdout).not.toContain("super-secret-value-should-never-appear");
    expect(result.stderr).not.toContain("super-secret-value-should-never-appear");
  });
});

describe("verify-backup.sh — argument validation (no docker/database needed)", () => {
  it("exits with usage error when called with no arguments", () => {
    const result = runVerifyScript([]);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Usage:/);
  });

  it("fails when the given file does not exist", () => {
    const result = runVerifyScript([path.join(tmpdir(), "definitely-does-not-exist.dump")]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/file not found/);
  });

  it("fails when the given file is empty", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "insurance-verify-test-"));
    const emptyFile = path.join(dir, "empty.dump");
    writeFileSync(emptyFile, "");
    try {
      const result = runVerifyScript([emptyFile]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/file is empty/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
