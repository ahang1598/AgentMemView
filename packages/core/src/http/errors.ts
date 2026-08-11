import type { Context } from "hono";
import { ZodError } from "zod";
import { ConflictError, type ValidationError } from "../dao/errors.js";

/**
 * Error mapping layer: DAO domain errors → HTTP status codes (Spec section 11).
 * Registered via app.onError — hono's compose converts thrown errors to
 * responses at the innermost dispatch, so try/catch middleware never sees
 * them; onError is the only reliable interception point.
 */
export function handleApiError(err: Error, c: Context): Response | undefined {
  // Match domain errors by name: instanceof can fail when the class is loaded
  // through two module instances (workspace links, test bundling).
  if (err.name === "NotFoundError") {
    return c.json({ error: "not_found", message: err.message }, 404);
  }
  if (err instanceof ConflictError || err.name === "ConflictError") {
    const conflict = err as ConflictError;
    return c.json(
      {
        error: "conflict",
        message: conflict.message,
        childrenCount: conflict.childrenCount,
      },
      409,
    );
  }
  if (err.name === "ValidationError" || err instanceof ZodError) {
    const fields =
      err instanceof ZodError
        ? err.issues.map((issue) => issue.path.join("."))
        : (err as ValidationError).fields;
    return c.json({ error: "validation", message: err.message, fields }, 400);
  }
  return undefined;
}
