import { describe, expect, it } from "vitest";
import { DEFAULT_REDACTION_RULES, redact } from "../../src/redaction/redactor.js";

describe("redactor (AC-07)", () => {
  it("redacts openai/anthropic/github/aws/generic api keys", () => {
    const samples: Array<{ input: string; secret: string; label: string }> = [
      {
        input: "my key sk-abcDEF1234567890abcDEF1234567890xyzt ok",
        secret: "sk-abcDEF1234567890abcDEF1234567890xyzt",
        label: "[REDACTED:openai-key]",
      },
      {
        input: "key: sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcDEF",
        secret: "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcDEF",
        label: "[REDACTED:anthropic-key]",
      },
      {
        input: "token ghp_ABCDEFghijkl0123456789MNOPqrstuv12 done",
        secret: "ghp_ABCDEFghijkl0123456789MNOPqrstuv12",
        label: "[REDACTED:github-token]",
      },
      {
        input: "aws AKIAIOSFODNN7EXAMPLE here",
        secret: "AKIAIOSFODNN7EXAMPLE",
        label: "[REDACTED:aws-key]",
      },
    ];
    for (const { input, secret, label } of samples) {
      const result = redact(input);
      expect(result.count).toBeGreaterThanOrEqual(1);
      expect(result.text).toContain(label);
      // the raw secret must be gone
      expect(result.text).not.toContain(secret);
    }
    // generic long bearer-style key
    const generic = redact("Authorization: Bearer abcdef1234567890abcdef1234567890abcdef12");
    expect(generic.count).toBeGreaterThanOrEqual(1);
    expect(generic.text).toContain("[REDACTED:");
  });

  it("redacts <private> tags entirely", () => {
    const input = "before <private>secret ssn 123-45-6789</private> after";
    const result = redact(input);
    expect(result.text).not.toContain("123-45-6789");
    expect(result.text).toContain("[REDACTED:private-tag]");
    expect(result.count).toBeGreaterThanOrEqual(1);
  });

  it("supports user-defined custom rules", () => {
    const rules = [...DEFAULT_REDACTION_RULES];
    rules.push({ name: "ticket", pattern: "TICKET-\\d{6}", replacement: "[REDACTED:ticket]" });
    const result = redact("see TICKET-123456 please", rules);
    expect(result.text).toBe("see [REDACTED:ticket] please");
  });

  it("leaves clean text untouched", () => {
    const result = redact("用户偏好 pnpm 而非 npm");
    expect(result.text).toBe("用户偏好 pnpm 而非 npm");
    expect(result.count).toBe(0);
  });
});
