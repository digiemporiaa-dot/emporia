#!/usr/bin/env node
import { cpSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";

/**
 * Run the production build the way the image runs it.
 *
 * `next start` does not work with `output: "standalone"` — Next says so on
 * every boot, and the result is not a clean failure: the server comes up and
 * serves most of the site, while some routes answer 404. That cost a whole
 * debugging session once, diagnosed as a caching problem, because the warning
 * scrolls past and everything looks fine.
 *
 * So `npm start` does what the Dockerfile does instead: copies the static
 * assets next to the traced server and runs it. `npm run start:next` is still
 * there for anyone who explicitly wants the unsupported thing.
 */

const SERVER = ".next/standalone/server.js";

if (!existsSync(SERVER)) {
  console.error("No standalone build found. Run `npm run build` first.");
  process.exit(1);
}

// The trace does not include these; the Dockerfile copies them in the same way.
cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
if (existsSync("public")) cpSync("public", ".next/standalone/public", { recursive: true });

const child = spawn(process.execPath, [SERVER], { stdio: "inherit" });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
