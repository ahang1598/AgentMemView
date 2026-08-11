/**
 * Domain errors thrown by the DAO layer. The HTTP layer maps them to status
 * codes (404/409/400); services may translate them into business errors.
 * Never swallow these silently.
 */

export class NotFoundError extends Error {
  constructor(resource: string, id: string) {
    super(`${resource} "${id}" not found`);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends Error {
  readonly childrenCount: number;

  constructor(message: string, childrenCount = 0) {
    super(message);
    this.name = "ConflictError";
    this.childrenCount = childrenCount;
  }
}

export class ValidationError extends Error {
  readonly fields: string[];

  constructor(message: string, fields: string[] = []) {
    super(message);
    this.name = "ValidationError";
    this.fields = fields;
  }
}
