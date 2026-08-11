import { randomUUID } from "node:crypto";
import type { AgentMemViewDatabase } from "../db/database.js";
import { CapabilityOffError, type LLMProvider } from "../providers/llm/types.js";

/**
 * L3 profile update (Spec section 5): versioned rows, full-text injected
 * every turn (byte-stable). Skipped entirely when the LLM capability is off.
 */

export interface UpdateProfileInput {
  scopeKey: string;
  llm: LLMProvider;
}

export interface UpdateProfileResult {
  skipped: boolean;
  version?: number | undefined;
}

export async function updateProfile(
  db: AgentMemViewDatabase,
  input: UpdateProfileInput,
): Promise<UpdateProfileResult> {
  let text: string;
  try {
    const result = await input.llm.chat([
      {
        role: "system",
        content:
          "根据已有记忆与最近会话，输出更新后的用户画像 Markdown（稳定偏好/习惯/角色）。只输出 Markdown 正文。",
      },
      { role: "user", content: `scope: ${input.scopeKey}` },
    ]);
    text = result.text.trim();
  } catch (err) {
    if (err instanceof CapabilityOffError) {
      return { skipped: true };
    }
    throw err;
  }
  if (text.length === 0) {
    return { skipped: true };
  }
  const latest = db
    .prepare(`SELECT version FROM l3_profiles WHERE scope_key = ? ORDER BY version DESC LIMIT 1`)
    .get(input.scopeKey) as { version: number } | undefined;
  const nextVersion = (latest?.version ?? 0) + 1;
  db.prepare(
    `INSERT INTO l3_profiles (id, scope_key, content_md, version, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(randomUUID(), input.scopeKey, text, nextVersion, new Date().toISOString());
  return { skipped: false, version: nextVersion };
}
