// Dev workflow: build the server with tsc --watch, build the client with esbuild --watch,
// and run the compiled CLI under nodemon-lite supervision.
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const procs = [];

function start(cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    cwd: root,
    stdio: "inherit",
    shell: false,
    ...opts,
  });
  procs.push(child);
  child.on("exit", (code) => {
    if (code !== 0) {
      console.error(`[dev] ${cmd} ${args.join(" ")} exited with ${code}`);
    }
  });
  return child;
}

// Server: tsc --watch for incremental compilation into dist/server.
start("npx", ["tsc", "-p", "tsconfig.server.json", "--watch", "--preserveWatchOutput"]);
// Client: esbuild watch + static copy.
start("node", ["scripts/build-client.mjs", "--watch"]);

// Server runner: re-launch the CLI when dist changes. Pass through user args.
const userArgs = process.argv.slice(2);
let server = null;
let restartTimer = null;

async function restart() {
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    if (server) {
      server.kill("SIGTERM");
    }
    server = spawn("node", ["dist/server/cli.js", ...userArgs], {
      cwd: root,
      stdio: "inherit",
    });
    procs.push(server);
  }, 400);
}

import { watch } from "node:fs/promises";
const watcher = watch(resolve(root, "dist/server"), { recursive: true });
(async () => {
  // initial start, even if no events have fired yet
  setTimeout(() => restart(), 1500);
  for await (const _ of watcher) {
    restart();
  }
})().catch((err) => console.error("[dev] watcher error:", err));

const shutdown = () => {
  for (const p of procs) {
    try {
      p.kill("SIGTERM");
    } catch {
      // ignore
    }
  }
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
