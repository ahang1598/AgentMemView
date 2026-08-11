// P0 visual-discipline scanner: emoji feature icons, hardcoded colors,
// placeholder copy. Exit 1 on any hit. Usage: node scripts/scan-rules.mjs
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = path.join(root, "src");

const EMOJI_RE = /\p{Extended_Pictographic}/u;
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
const ALLOWED_HEX = new Set(["#fff", "#000", "#ffffff", "#000000"]);
const PLACEHOLDER_BLACKLIST = ["Welcome to", "Lorem ipsum", "coming soon", "placeholder", "TODO:"];

const findings = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full);
      continue;
    }
    if (!/\.(tsx?|css)$/.test(entry)) {
      continue;
    }
    const rel = path.relative(root, full);
    const text = readFileSync(full, "utf8");
    const lines = text.split("\n");
    lines.forEach((line, index) => {
      if (EMOJI_RE.test(line)) {
        findings.push(`${rel}:${index + 1} emoji: ${line.trim().slice(0, 60)}`);
      }
      const isTokens = rel.endsWith(path.join("styles", "tokens.css"));
      if (!isTokens) {
        for (const hex of line.match(HEX_RE) ?? []) {
          if (!ALLOWED_HEX.has(hex.toLowerCase())) {
            findings.push(`${rel}:${index + 1} hardcoded color ${hex}`);
          }
        }
      }
      // placeholder copy: only scan quoted strings and JSX text nodes,
      // never attribute names (the HTML placeholder attribute is legitimate)
      const quoted = line.match(/"[^"]*"|'[^']*'|`[^`]*`/g) ?? [];
      const jsxText = line.match(/>([^<>{}]+)</g) ?? [];
      const haystack = [...quoted, ...jsxText].join(" ").toLowerCase();
      for (const banned of PLACEHOLDER_BLACKLIST) {
        if (haystack.includes(banned.toLowerCase())) {
          findings.push(`${rel}:${index + 1} placeholder copy "${banned}"`);
        }
      }
    });
  }
}

walk(SRC_DIR);
if (findings.length > 0) {
  console.error("P0 scan failed:");
  for (const finding of findings) {
    console.error(`  ${finding}`);
  }
  process.exit(1);
}
console.log("P0 scan clean: no emoji icons, no hardcoded colors, no placeholder copy.");
