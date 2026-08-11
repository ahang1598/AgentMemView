/**
 * Local access key auth. Single-user local product: when no key is
 * configured the proxy is open on loopback; when configured (env
 * AGENTMEMVIEW_ACCESS_KEY or capability center), every proxied request must
 * carry x-agentmemview-key. Health stays open.
 */

export const ACCESS_KEY_HEADER = "x-agentmemview-key";

export function checkAccessKey(
  configured: string | undefined,
  provided: string | undefined,
): boolean {
  if (configured === undefined || configured.length === 0) {
    return true;
  }
  return provided !== undefined && provided === configured;
}
