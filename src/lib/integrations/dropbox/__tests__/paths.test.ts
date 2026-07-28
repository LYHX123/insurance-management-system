import { describe, it, expect } from "vitest";
import { normalizeRootFolder, joinDropboxPath, assertInsideRoot } from "../paths";
import { DropboxIntegrationError } from "../errors";
import { DEFAULT_DROPBOX_ROOT_FOLDER } from "../constants";

describe("normalizeRootFolder (Part 20.C)", () => {
  it("accepts the default root", () => {
    expect(normalizeRootFolder(DEFAULT_DROPBOX_ROOT_FOLDER)).toBe(DEFAULT_DROPBOX_ROOT_FOLDER);
  });

  it("rejects the Dropbox root \"/\"", () => {
    expect(() => normalizeRootFolder("/")).toThrow(DropboxIntegrationError);
  });

  it("rejects a path not starting with \"/\"", () => {
    expect(() => normalizeRootFolder("Insurance Management System")).toThrow(DropboxIntegrationError);
  });

  it("rejects traversal via \"..\" segments", () => {
    expect(() => normalizeRootFolder("/../Other System")).toThrow(DropboxIntegrationError);
    expect(() => normalizeRootFolder("../Other System")).toThrow(DropboxIntegrationError);
    expect(() => normalizeRootFolder("/Insurance Management System/../../Other System")).toThrow(DropboxIntegrationError);
  });

  it("rejects control characters", () => {
    expect(() => normalizeRootFolder("/Insurance\x00System")).toThrow(DropboxIntegrationError);
    expect(() => normalizeRootFolder("/Insurance\x1fSystem")).toThrow(DropboxIntegrationError);
  });

  it("strips a trailing slash", () => {
    expect(normalizeRootFolder("/Insurance Management System/")).toBe("/Insurance Management System");
  });

  it("collapses accidental double slashes", () => {
    expect(normalizeRootFolder("//Insurance Management System//Sub//")).toBe("/Insurance Management System/Sub");
  });
});

describe("joinDropboxPath prefix-confusion safety (Part 20.C)", () => {
  const root = "/Insurance Management System";

  it("joins a simple relative path under the root", () => {
    expect(joinDropboxPath(root, "Customer A")).toBe("/Insurance Management System/Customer A");
  });

  it("rejects a relative path containing \"..\"", () => {
    expect(() => joinDropboxPath(root, "../Other System")).toThrow(DropboxIntegrationError);
  });

  it("does not let a sibling folder with a similar name pass as inside the root", () => {
    // The classic prefix-confusion case from the spec: "/Insurance
    // Management System 2" must NOT be treated as inside
    // "/Insurance Management System" by a naive startsWith() check.
    const sibling = "/Insurance Management System 2";
    expect(() => assertInsideRoot(sibling, root)).toThrow(DropboxIntegrationError);
  });

  it("accepts the root path itself as inside the root", () => {
    expect(() => assertInsideRoot(root, root)).not.toThrow();
  });

  it("accepts a genuine nested path as inside the root", () => {
    expect(() => assertInsideRoot(`${root}/Customer A/Documents`, root)).not.toThrow();
  });
});
