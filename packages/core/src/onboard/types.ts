/**
 * Onboarding adapters: write agent configs idempotently with backup/restore.
 * Never overwrite a conflicting existing gateway URL — report instead.
 */

/**
 * Optional env overrides written into the claude-code settings alongside
 * ANTHROPIC_BASE_URL. Only the provided keys are touched; every other entry
 * in the user's env block stays byte-identical (merge, never replace).
 */
export interface ClaudeEnvOptions {
  authToken?: string | undefined;
  defaultHaikuModel?: string | undefined;
  defaultSonnetModel?: string | undefined;
  defaultOpusModel?: string | undefined;
  autoCompactWindow?: string | undefined;
  disableNonessentialTraffic?: boolean | undefined;
  apiTimeoutMs?: string | undefined;
}

export interface OnboardConfig {
  /** Target HOME (tests point this at a temp dir). */
  homeDir: string;
  proxyBaseUrl: string;
  spaceId: string;
  /** Overwrite an existing conflicting base-url (backup kept for restore). */
  force?: boolean | undefined;
  /** claude-code only: extra env keys to merge into settings.json. */
  claudeEnv?: ClaudeEnvOptions | undefined;
}

export interface OnboardResult {
  changed: boolean;
  note?: string | undefined;
}

export interface OnboardAdapter {
  name: string;
  detect(cfg: OnboardConfig): boolean;
  install(cfg: OnboardConfig): OnboardResult;
  restore(cfg: OnboardConfig): void;
}
