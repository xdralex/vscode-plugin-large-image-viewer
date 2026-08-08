import { rm } from "node:fs/promises";
import { build } from "esbuild";

await rm(new URL("./dist", import.meta.url), { recursive: true, force: true });

await Promise.all([
  build({
    entryPoints: ["src/extension.ts"],
    outfile: "dist/extension.cjs",
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    external: ["vscode", "sharp"],
    sourcemap: true,
  }),
  build({
    entryPoints: ["src/webview.ts"],
    outfile: "dist/webview.js",
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome120",
    minify: true,
  }),
  build({
    entryPoints: ["src/smoke-test.ts"],
    outfile: "dist/smoke-test.cjs",
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    external: ["sharp"],
  }),
]);
