import { describe, it, expect } from "vitest";
import { getClientIp } from "../clientIp";

describe("getClientIp", () => {
  it("uses the first hop of X-Forwarded-For when present", () => {
    const request = new Request("http://localhost/", {
      headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1, 10.0.0.2" },
    });
    expect(getClientIp(request)).toBe("203.0.113.7");
  });

  it("trims whitespace around the first hop", () => {
    const request = new Request("http://localhost/", {
      headers: { "x-forwarded-for": "  203.0.113.7  , 10.0.0.1" },
    });
    expect(getClientIp(request)).toBe("203.0.113.7");
  });

  it("falls back to X-Real-IP when X-Forwarded-For is absent", () => {
    const request = new Request("http://localhost/", {
      headers: { "x-real-ip": "198.51.100.9" },
    });
    expect(getClientIp(request)).toBe("198.51.100.9");
  });

  it("falls back to 'unknown' when neither header is present", () => {
    const request = new Request("http://localhost/");
    expect(getClientIp(request)).toBe("unknown");
  });

  it("falls back to 'unknown' when X-Forwarded-For is present but empty", () => {
    const request = new Request("http://localhost/", {
      headers: { "x-forwarded-for": "" },
    });
    expect(getClientIp(request)).toBe("unknown");
  });
});
