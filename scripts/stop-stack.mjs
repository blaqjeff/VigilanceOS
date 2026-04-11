import { spawnSync } from "node:child_process";

const PORTS = [3001, 4001, 4000];

function parseNumericLines(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d+$/.test(line));
}

function getPortPidsWindows(port) {
  const result = spawnSync("netstat", ["-ano"], { encoding: "utf8" });

  if (result.status !== 0) {
    return [];
  }

  const needle = `:${port}`;
  return String(result.stdout ?? "")
    .split(/\r?\n/)
    .filter((line) => line.includes(needle) && /\bLISTENING\b/i.test(line))
    .map((line) => line.trim().split(/\s+/).pop())
    .filter((value) => value && /^\d+$/.test(value));
}

function getPortPidsUnix(port) {
  const result = spawnSync("lsof", ["-ti", `tcp:${port}`], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    return [];
  }
  return parseNumericLines(result.stdout);
}

function getAllPids() {
  const resolver = process.platform === "win32" ? getPortPidsWindows : getPortPidsUnix;
  return [...new Set(PORTS.flatMap((port) => resolver(port)))];
}

function killPid(pid) {
  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/PID", String(pid), "/F"], { encoding: "utf8" });
    return result.status === 0;
  }

  const result = spawnSync("kill", ["-9", String(pid)], { encoding: "utf8" });
  return result.status === 0;
}

const pids = getAllPids();

if (pids.length === 0) {
  console.log("No listeners were using ports 3001, 4001, or 4000.");
  process.exit(0);
}

const stopped = pids.filter((pid) => killPid(pid));

if (stopped.length === 0) {
  console.error(`Found listeners (${pids.join(", ")}) but failed to stop them.`);
  process.exit(1);
}

console.log(`Stopped listeners on 3001/4001/4000 (PIDs: ${stopped.join(", ")}).`);
