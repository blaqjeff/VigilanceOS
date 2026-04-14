import { spawn } from "node:child_process";

const mode = process.argv[2];

if (!mode || !["dev", "start"].includes(mode)) {
  console.error("Usage: node ./scripts/run-stack.mjs <dev|start>");
  process.exit(1);
}

function spawnNamed(name, command) {
  const child = spawn(command, {
    stdio: "inherit",
    shell: true,
    env: process.env,
  });

  child.on("error", (error) => {
    console.error(`[${name}] failed to start: ${error.message}`);
  });

  return child;
}

const backendCommand = mode === "start" ? "npm run start:eliza" : "npm run dev:eliza";
const uiCommand = mode === "start" ? "npm run start:ui" : "npm run dev:ui";

const backend = spawnNamed("backend", backendCommand);
const ui = spawnNamed("ui", uiCommand);
const children = [backend, ui];

let shuttingDown = false;
let exitCode = 0;

function terminate(signal = "SIGTERM", code = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  exitCode = code;
  for (const child of children) {
    if (!child.killed) {
      try {
        child.kill(signal);
      } catch {}
    }
  }

  setTimeout(() => process.exit(exitCode), 250).unref();
}

for (const [name, child] of [
  ["backend", backend],
  ["ui", ui],
]) {
  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`;
    console.error(`[${name}] exited with ${reason}. Shutting down the stack.`);
    terminate("SIGTERM", typeof code === "number" ? code : 1);
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => terminate(signal));
}
