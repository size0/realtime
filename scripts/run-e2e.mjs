import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const projectRoot = process.cwd();
const baseUrl = "http://127.0.0.1:3100";
const nextCli = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");
const playwrightCli = path.join(projectRoot, "node_modules", "@playwright", "test", "cli.js");
const resultDirectory = path.join(projectRoot, "test-results");
const e2eDataFile = path.join(resultDirectory, "e2e-users.json");
const e2eDatabaseFile = path.join(resultDirectory, "e2e-app.sqlite");
const e2eEnv = {
  ...process.env,
  APP_DATA_FILE: e2eDataFile,
  APP_DATABASE_FILE: e2eDatabaseFile,
  APP_ORIGIN: baseUrl,
  ADMIN_USERNAME: "admin",
  ADMIN_DISPLAY_NAME: "管理员",
  ADMIN_PASSWORD: "Admin-password-123",
  SESSION_SECRET: "e2e-session-secret-that-is-longer-than-32-characters",
  VOICE_WORKER_SECRET: "e2e-worker-secret-that-is-longer-than-32-characters",
  OAUTH_IDENTITY_SECRET: "e2e-oauth-secret-that-is-longer-than-32-characters",
  MESSAGE_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
};

function waitForExit(child) {
  return new Promise((resolve) => child.once("exit", (code) => resolve(code ?? 1)));
}

async function waitForServer(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Next.js did not become ready at ${baseUrl} within ${timeoutMs}ms.`);
}

async function clearE2eData() {
  const targets = [
    e2eDataFile,
    e2eDatabaseFile,
    `${e2eDatabaseFile}-wal`,
    `${e2eDatabaseFile}-shm`,
  ];
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      for (const target of targets) await rm(target, { force: true });
      return;
    } catch (error) {
      if (error?.code !== "EBUSY" || attempt === 9) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

await mkdir(resultDirectory, { recursive: true });
await clearE2eData();
const server = spawn(
  process.execPath,
  [nextCli, "dev", "--hostname", "127.0.0.1", "--port", "3100"],
  { cwd: projectRoot, env: e2eEnv, stdio: "inherit" },
);

let exitCode = 1;
try {
  await waitForServer();
  const playwright = spawn(process.execPath, [playwrightCli, "test"], {
    cwd: projectRoot,
    env: e2eEnv,
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
  await clearE2eData();
}

process.exitCode = exitCode;
