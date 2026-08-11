import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src");

describe("theme tokens (M5-06)", () => {
  it("dark theme overrides every light color token", () => {
    const css = readFileSync(path.join(srcDir, "styles/tokens.css"), "utf8");
    const lightSection = css.slice(css.indexOf(":root"), css.indexOf(".dark"));
    const darkSection = css.slice(css.indexOf(".dark"));
    const tokenRe = /(--[a-z0-9-]+)\s*:/g;
    // layout tokens (radius/spacing/font) have no dark variants by design
    const isColorToken = (token: string): boolean =>
      !token.startsWith("--radius") && !token.startsWith("--space") && !token.startsWith("--font");
    const lightTokens = [...lightSection.matchAll(tokenRe)]
      .map((m) => m[1] as string)
      .filter(isColorToken);
    const darkTokens = new Set([...darkSection.matchAll(tokenRe)].map((m) => m[1]));
    expect(lightTokens.length).toBeGreaterThan(0);
    for (const token of lightTokens) {
      expect(darkTokens.has(token)).toBe(true);
    }
  });

  it("structural styles only use token variables for colors", () => {
    const base = readFileSync(path.join(srcDir, "styles/base.css"), "utf8");
    // color-bearing properties only (border-radius/collapse etc. are structural)
    const colorProps =
      base.match(
        /(?:^|[{;])\s*(color|background|background-color|border|border-color)\s*:\s*([^;]+);/g,
      ) ?? [];
    expect(colorProps.length).toBeGreaterThan(0);
    for (const declaration of colorProps) {
      expect(declaration).toMatch(/var\(--[a-z0-9-]+\)/);
    }
  });
});
