import { Command } from "commander";
import { doctorAction } from "./commands/doctor.js";

export function createCli(): Command {
  const program = new Command();
  program.name("memokit").description("MemoKit agent memory system CLI").version("0.1.0");

  program
    .command("doctor")
    .description("Run environment health checks (node, sqlite-vec, ports, storage)")
    .option("--json", "output a machine-readable JSON report")
    .action(doctorAction);

  return program;
}
