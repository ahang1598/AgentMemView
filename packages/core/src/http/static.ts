import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Static hosting for the UI build (M3-14): hashed /assets/* get immutable
 * cache headers; every other non-API path falls back to index.html (SPA).
 */

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function contentTypeOf(file: string): string {
  return CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream";
}

/**
 * Resolve a request path against the static dir.
 * Returns undefined when nothing applies (caller keeps the API 404).
 */
export function staticFileResponse(staticDir: string, pathname: string): Response | undefined {
  if (pathname.startsWith("/api/")) {
    return undefined;
  }
  const safePath = path.normalize(pathname).replace(/^([/\\])+/, "");
  const candidate = safePath.length === 0 ? "index.html" : safePath;
  const file = path.join(staticDir, candidate);
  // path traversal guard
  if (!path.resolve(file).startsWith(path.resolve(staticDir))) {
    return undefined;
  }
  if (existsSync(file) && statSync(file).isFile()) {
    const immutable = pathname.startsWith("/assets/");
    return new Response(readFileSync(file), {
      headers: {
        "content-type": contentTypeOf(file),
        "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      },
    });
  }
  // SPA fallback for extension-less routes
  const index = path.join(staticDir, "index.html");
  if (!safePath.includes(".") && existsSync(index)) {
    return new Response(readFileSync(index), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" },
    });
  }
  return undefined;
}
