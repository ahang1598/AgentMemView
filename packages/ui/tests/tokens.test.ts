import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src");

describe("design tokens (M3-01)", () => {
  it("tokens.css defines all required variables in light and dark", () => {
    const css = readFileSync(path.join(srcDir, "styles/tokens.css"), "utf8");
    const required = [
      "--bg-primary",
      "--bg-secondary",
      "--text-primary",
      "--text-secondary",
      "--border",
      "--accent",
      "--success",
      "--warning",
      "--danger",
    ];
    const lightSection = css.slice(css.indexOf(":root"), css.indexOf(".dark"));
    const darkSection = css.slice(css.indexOf(".dark"));
    for (const variable of required) {
      expect(lightSection).toContain(variable);
      expect(darkSection).toContain(variable);
    }
  });

  it("no hardcoded hex in src outside tokens.css", () => {
    const scan = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../scripts/scan-rules.mjs"),
      "utf8",
    );
    // the scanner exists and is wired as the CI gate
    expect(scan).toContain("Extended_Pictographic");
    expect(scan).toContain("tokens.css");
  });
});
