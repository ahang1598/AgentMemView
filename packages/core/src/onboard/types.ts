/**
 * Onboarding adapters: write agent configs idempotently with backup/restore.
 * Never overwrite a conflicting existing gateway URL — report instead.
 */

export interface OnboardConfig {
  /** Target HOME (tests point this at a temp dir). */
  homeDir: string;
  proxyBaseUrl: string;
  spaceId: string;
  /** Overwrite an existing conflicting base-url (backup kept for restore). */
  force?: boolean | undefined;
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
