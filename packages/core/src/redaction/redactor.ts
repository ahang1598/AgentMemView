/**
 * Secret redactor (AC-07): strip suspected credentials before L0 persistence.
 * Rule table is extensible — user-defined rules append to the built-ins.
 */

export interface RedactionRule {
  name: string;
  /** Source pattern; compiled case-insensitive and global. */
  pattern: string;
  replacement: string;
}

export interface RedactionResult {
  text: string;
  count: number;
}

export const DEFAULT_REDACTION_RULES: RedactionRule[] = [
  // <private>...</private> blocks are removed wholesale.
  {
    name: "private-tag",
    pattern: "<private>[\\s\\S]*?<\\/private>",
    replacement: "[REDACTED:private-tag]",
  },
  // PEM private key blocks.
  {
    name: "pem-key",
    pattern: "-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----",
    replacement: "[REDACTED:pem-key]",
  },
  // Anthropic must precede OpenAI (sk-ant- is also sk-*).
  {
    name: "anthropic-key",
    pattern: "sk-ant-[A-Za-z0-9_-]{20,}",
    replacement: "[REDACTED:anthropic-key]",
  },
  { name: "openai-key", pattern: "sk-[A-Za-z0-9_-]{20,}", replacement: "[REDACTED:openai-key]" },
  {
    name: "github-token",
    pattern: "gh[pousr]_[A-Za-z0-9]{20,}",
    replacement: "[REDACTED:github-token]",
  },
  { name: "aws-key", pattern: "(?:AKIA|ASIA)[0-9A-Z]{16}", replacement: "[REDACTED:aws-key]" },
  { name: "google-key", pattern: "AIza[0-9A-Za-z_-]{35}", replacement: "[REDACTED:google-key]" },
  {
    name: "slack-token",
    pattern: "xox[baprs]-[A-Za-z0-9-]{10,}",
    replacement: "[REDACTED:slack-token]",
  },
  {
    name: "jwt",
    pattern: "eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{5,}",
    replacement: "[REDACTED:jwt]",
  },
  {
    name: "bearer-token",
    pattern: "Bearer\\s+[A-Za-z0-9._~+/=-]{20,}",
    replacement: "Bearer [REDACTED:bearer-token]",
  },
];

/** Apply rules in order; returns masked text plus total replacement count. */
export function redact(
  input: string,
  rules: RedactionRule[] = DEFAULT_REDACTION_RULES,
): RedactionResult {
  let text = input;
  let count = 0;
  for (const rule of rules) {
    const regex = new RegExp(rule.pattern, "gi");
    text = text.replace(regex, () => {
      count += 1;
      return rule.replacement;
    });
  }
  return { text, count };
}
