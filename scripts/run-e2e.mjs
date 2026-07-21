import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const projectRoot = process.cwd();
const baseUrl = "http://127.0.0.1:3100";
const nextCli = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");
const playwrightCli = path.join(projectRoot, "node_modules", "@playwright", "test", "cli.js");

function waitForExit(child) {
  return new Promise((resolve) => child.once("exit", (code) => resolve(code ?? 1)));
}

async function waitForServer(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // The server is still starting; retry until the bounded deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Next.js did not become ready at ${baseUrl} within ${timeoutMs}ms.`);
}

const server = spawn(
  process.execPath,
  [nextCli, "dev", "--hostname", "127.0.0.1", "--port", "3100"],
  { cwd: projectRoot, env: process.env, stdio: "inherit" },
);

let exitCode = 1;
try {
  await waitForServer();
  const playwright = spawn(process.execPath, [playwrightCli, "test"], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
  });
  exitCode = await waitForExit(playwright);
} finally {
  if (server.exitCode === null) server.kill();
  await Promise.race([
    waitForExit(server),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

process.exitCode = exitCode;
