import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraph } from "./graph.ts";
import { model } from "./model.ts";
import { OUTPUT_DIRECTORY, renderOutputs } from "./render.ts";

const root = realpathSync(fileURLToPath(new URL("../../", import.meta.url)));

function read(path: string) {
  try {
    const resolved = realpathSync(join(root, path));
    if (!resolved.startsWith(root + sep))
      throw new Error(`Source outside repository: ${path}`);
    return readFileSync(resolved, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function main() {
  const [mode, ...rest] = process.argv.slice(2);
  if ((mode !== "--write" && mode !== "--check") || rest.length) {
    throw new Error("Usage: node scripts/architecture/cli.ts --write|--check");
  }

  const outputs = renderOutputs(buildGraph(model, read));
  const stale: string[] = [];
  for (const [name, contents] of outputs) {
    const path = `${OUTPUT_DIRECTORY}/${name}`;
    if (read(path) === contents) continue;
    if (mode === "--write") writeFileSync(join(root, path), contents);
    else stale.push(path);
  }
  if (stale.length) {
    throw new Error(
      `Stale architecture files:\n${stale.join("\n")}\nRun pnpm architecture:generate and review the diff.`,
    );
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
