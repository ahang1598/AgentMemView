import { cpSync, existsSync, mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });
if (existsSync("src/db/migrations")) {
  cpSync("src/db/migrations", "dist/db/migrations", { recursive: true });
}
