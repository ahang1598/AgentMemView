import { Command } from "commander";
import { doctorAction } from "./commands/doctor.js";
import { initAction } from "./commands/init.js";
import { exportAction, importAction } from "./commands/mempack.js";
import { startAction, stopAction } from "./commands/start.js";

export function createCli(): Command {
  const program = new Command();
  program.name("agentmemview").description("AgentMemView agent memory system CLI").version("0.1.0");

  program
    .command("doctor")
    .description("Run environment health checks (node, sqlite-vec, ports, storage)")
    .option("--json", "output a machine-readable JSON report")
    .action(doctorAction);

  program
    .command("init")
    .description("Connect coding agents to the proxy (idempotent, backup/restore)")
    .option("--agent <name>", "agent to configure (claude-code|codex|opencode)")
    .option("--restore", "revert all changes made by init")
    .option("--home <dir>", "target HOME directory (defaults to real home)")
    .option("--space <spaceId>", "space id to wire", "default")
    .option("--proxy-url <url>", "proxy base url", "http://127.0.0.1:8619")
    .action(initAction);

  program
    .command("start")
    .description("Start the core REST server (:8620)")
    .option("-d, --detach", "run in background with a pid file")
    .option("--foreground", "internal: run in foreground (used by --detach child)")
    .option("--port <port>", "listen port", "8620")
    .option("--host <host>", "listen host", "127.0.0.1")
    .option("--data <dir>", "data home directory")
    .action(startAction);

  program
    .command("stop")
    .description("Stop a detached core server via its pid file")
    .option("--data <dir>", "data home directory")
    .action(stopAction);

  program
    .command("export")
    .description("Export the database to a .mempack bundle")
    .option("--data <dir>", "data home directory")
    .option("--out <file>", "output .mempack path")
    .action(exportAction);

  program
    .command("import <pack>")
    .description("Import a .mempack bundle into the data home")
    .option("--data <dir>", "data home directory")
    .action(importAction);

  return program;
}
