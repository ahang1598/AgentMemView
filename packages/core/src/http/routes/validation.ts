import { zValidator } from "@hono/zod-validator";
import type { ZodType } from "zod";

type Target = "json" | "query" | "param" | "header" | "form";

/**
 * zValidator with the project-wide 400 envelope:
 * { error: "validation", message, fields: string[] }.
 */
export function validate<T extends ZodType>(target: Target, schema: T) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: "validation",
          message: result.error.issues[0]?.message ?? "invalid request",
          fields: result.error.issues.map((issue) => issue.path.join(".")),
        },
        400,
      );
    }
  });
}
