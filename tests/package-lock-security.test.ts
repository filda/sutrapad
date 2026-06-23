import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function isAboveVulnerableVersion(version: string): boolean {
  const [major = 0, minor = 0, patch = 0] = version
    .split(".", 3)
    .map((part) => {
      const numericValue = Number.parseInt(part, 10);
      return Number.isNaN(numericValue) ? 0 : numericValue;
    });

  return major > 7 || (major === 7 && (minor > 29 || (minor === 29 && patch > 0)));
}

describe("package-lock security guard", () => {
  it("pins @babel/core above the GHSA-4x5r-pxfx-6jf8 vulnerable range", () => {
    const lockFile = JSON.parse(
      readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"),
    ) as {
      packages?: Record<string, { version?: string }>;
    };

    const babelCoreVersion =
      lockFile.packages?.["node_modules/@babel/core"]?.version;
    expect(babelCoreVersion).toBeTypeOf("string");
    expect(isAboveVulnerableVersion(babelCoreVersion ?? "0.0.0")).toBe(true);
  });
});
