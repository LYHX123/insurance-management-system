import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Integration-level coverage for the Customer document Preview/Download
// route: this is the exact route that crashed in production with
// "Cannot convert argument to a ByteString" for Chinese filenames
// (e.g. 中铁七局注册已公证文件.pdf). These tests exercise the real GET
// handler end-to-end (auth -> DB lookup -> storage read -> response), only
// mocking the auth/DB/storage boundaries.

const auth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: (...args: unknown[]) => auth(...args) }));

const hasPermission = vi.fn();
vi.mock("@/lib/permissions", () => ({ hasPermission: (...args: unknown[]) => hasPermission(...args) }));

type DocumentRow = {
  id: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  storageKey: string;
};
let documents: Map<string, DocumentRow>;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customerDocument: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) => documents.get(where.id) ?? null),
    },
  },
}));

const getFile = vi.fn();
vi.mock("@/lib/storage", () => ({
  storageService: { getFile: (...args: unknown[]) => getFile(...args) },
}));

function makeRequest(mode?: "download" | "inline") {
  const url = mode ? `http://localhost:3001/api/customer-documents/doc-1?mode=${mode}` : "http://localhost:3001/api/customer-documents/doc-1";
  return new NextRequest(url);
}

describe("Customer document Preview/Download route — Unicode filename fix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasPermission.mockReturnValue(true);
    auth.mockResolvedValue({ user: { id: "u1", role: "ADMIN" } });
    documents = new Map();
    getFile.mockResolvedValue({ buffer: Buffer.from("%PDF-1.4 fake"), mimeType: "application/pdf" });
  });

  async function callRoute(mode?: "download" | "inline") {
    const { GET } = await import("../[id]/route");
    return GET(makeRequest(mode), { params: Promise.resolve({ id: "doc-1" }) });
  }

  it("Preview: Chinese filename does not throw and Content-Disposition is inline with a safe fallback + filename*", async () => {
    documents.set("doc-1", {
      id: "doc-1",
      originalFileName: "中铁七局注册已公证文件.pdf",
      mimeType: "application/pdf",
      fileSize: 13,
      storageKey: "cust-1/doc-1.pdf",
    });

    const response = await callRoute();

    expect(response.status).toBe(200);
    const cd = response.headers.get("Content-Disposition")!;
    expect(cd.startsWith("inline;")).toBe(true);
    expect(cd).toMatch(/filename\*=UTF-8''%E4%B8%AD/); // percent-encoded "中..."
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
  });

  it("Download: Chinese filename does not throw, Content-Disposition is attachment, and the original name is recoverable", async () => {
    const original = "中铁七局注册已公证文件.pdf";
    documents.set("doc-1", {
      id: "doc-1",
      originalFileName: original,
      mimeType: "application/pdf",
      fileSize: 13,
      storageKey: "cust-1/doc-1.pdf",
    });

    const response = await callRoute("download");

    expect(response.status).toBe(200);
    const cd = response.headers.get("Content-Disposition")!;
    expect(cd.startsWith("attachment;")).toBe(true);
    const match = /filename\*=UTF-8''([^;]+)/.exec(cd);
    expect(match).not.toBeNull();
    expect(decodeURIComponent(match![1])).toBe(original);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
  });

  it("English filenames still work for both preview and download", async () => {
    documents.set("doc-1", {
      id: "doc-1",
      originalFileName: "Registration Certificate.pdf",
      mimeType: "application/pdf",
      fileSize: 13,
      storageKey: "cust-1/doc-1.pdf",
    });

    const previewResponse = await callRoute();
    expect(previewResponse.status).toBe(200);
    expect(previewResponse.headers.get("Content-Disposition")).toContain('filename="Registration Certificate.pdf"');

    const downloadResponse = await callRoute("download");
    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.headers.get("Content-Disposition")!.startsWith("attachment;")).toBe(true);
  });

  it("CRLF injection attempt in the stored filename cannot inject a second header", async () => {
    documents.set("doc-1", {
      id: "doc-1",
      originalFileName: 'evil.pdf"\r\nX-Injected: 1',
      mimeType: "application/pdf",
      fileSize: 13,
      storageKey: "cust-1/doc-1.pdf",
    });

    const response = await callRoute("download");

    expect(response.status).toBe(200);
    expect(response.headers.has("x-injected")).toBe(false);
    expect(response.headers.get("Content-Disposition")).not.toMatch(/[\r\n]/);
  });

  it("returns 404 without leaking a filesystem path when the file is missing from storage", async () => {
    documents.set("doc-1", {
      id: "doc-1",
      originalFileName: "Registration Certificate.pdf",
      mimeType: "application/pdf",
      fileSize: 13,
      storageKey: "cust-1/doc-1.pdf",
    });
    getFile.mockResolvedValue(null);

    const response = await callRoute("download");

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toMatch(/[A-Za-z]:\\|\/uploads\//);
  });

  // CASE H1-8 (Production Readiness Audit V1, finding H1): the download
  // route must set X-Content-Type-Options: nosniff, same as every other
  // document download route (policy/quotation/claim/invoice/ledger export).
  it("H1-8: response includes X-Content-Type-Options: nosniff", async () => {
    documents.set("doc-1", {
      id: "doc-1",
      originalFileName: "Registration Certificate.pdf",
      mimeType: "application/pdf",
      fileSize: 13,
      storageKey: "cust-1/doc-1.pdf",
    });

    const response = await callRoute();

    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("returns 403 when the caller lacks the customer permission", async () => {
    hasPermission.mockReturnValue(false);
    documents.set("doc-1", {
      id: "doc-1",
      originalFileName: "Registration Certificate.pdf",
      mimeType: "application/pdf",
      fileSize: 13,
      storageKey: "cust-1/doc-1.pdf",
    });

    const response = await callRoute("download");

    expect(response.status).toBe(403);
    expect(getFile).not.toHaveBeenCalled();
  });
});
