import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// Security regression guard for item 9 of the hardening plan (keep the CSP
// aligned with actual runtime needs). The `<meta http-equiv>` CSP in
// index.html is a defence-in-depth backstop: even if a rendering mistake
// injects markup, these directives stop it executing or phoning home. We pin
// the security-critical directives so an accidental loosening — adding
// `'unsafe-inline'` / `'unsafe-eval'` to script-src, or a stray connect-src
// host — fails CI rather than shipping silently.

const html = readFileSync(new URL("../index.html", import.meta.url), "utf-8");

const csp = (() => {
  const match = html.match(
    /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/u,
  );
  if (!match) throw new Error("CSP meta tag not found in index.html");
  return match[1];
})();

function directive(name: string): string {
  return (
    csp
      .split(";")
      .map((part) => part.trim())
      .find((part) => part === name || part.startsWith(`${name} `)) ?? ""
  );
}

describe("index.html Content-Security-Policy", () => {
  it("keeps script-src free of inline scripts and eval", () => {
    const scriptSrc = directive("script-src");
    expect(scriptSrc).toBe("script-src 'self' https://accounts.google.com");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it("locks down default-src, object-src, base-uri and form-action", () => {
    expect(directive("default-src")).toBe("default-src 'self'");
    expect(directive("object-src")).toBe("object-src 'none'");
    expect(directive("base-uri")).toBe("base-uri 'self'");
    expect(directive("form-action")).toBe("form-action 'self'");
  });

  it("limits connect-src to the known runtime hosts", () => {
    expect(directive("connect-src")).toBe(
      "connect-src 'self' https://accounts.google.com https://oauth2.googleapis.com https://www.googleapis.com https://api.open-meteo.com https://nominatim.openstreetmap.org https://api.allorigins.win",
    );
  });

  it("restricts frame-src to the Google sign-in origin", () => {
    expect(directive("frame-src")).toBe("frame-src https://accounts.google.com");
  });
});
