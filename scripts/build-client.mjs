// Bundles the client TypeScript with esbuild and copies static assets.
import { build } from "esbuild";
import { mkdir, copyFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const outDir = resolve(root, "dist/client");

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const watch = process.argv.includes("--watch");

const buildOptions = {
  entryPoints: [resolve(root, "src/client/main.ts")],
  bundle: true,
  format: "esm",
  target: "es2022",
  outfile: resolve(outDir, "main.js"),
  sourcemap: true,
  minify: !watch,
  logLevel: "info",
};

await copyFile(resolve(root, "src/client/index.html"), resolve(outDir, "index.html"));
await copyFile(resolve(root, "src/client/style.css"), resolve(outDir, "style.css"));

if (watch) {
  const ctx = await (await import("esbuild")).context(buildOptions);
  await ctx.watch();
  console.log("[build-client] watching for changes…");
} else {
  await build(buildOptions);
}
