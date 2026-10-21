import { build } from "../../node_modules/vite/dist/node/index.js";
import { resolve } from "node:path";
// Build the dormant function surface independently; it is intentionally absent
// from the shipped application graph until an explicit Model 2 activation.
await build({ configFile: false, root: resolve("apps/web"), publicDir: false,
  worker: { format: "es" }, build: { outDir: resolve(".cache/browser-build"), emptyOutDir: false,
    lib: { entry: resolve("scripts/browser-first-stack/runner-probe.ts"), formats: ["es"], fileName: "runner" } } });
