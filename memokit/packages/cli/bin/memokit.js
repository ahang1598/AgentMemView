#!/usr/bin/env node
import { createCli } from "../dist/index.js";

createCli()
  .parseAsync(process.argv)
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
