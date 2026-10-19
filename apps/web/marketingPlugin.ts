import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { Plugin } from "vite";

// Marketing is generated outside Vite's module graph, preserving the approved HTML.
export function marketingPages(): Plugin {
  let root = "";
  let output = "";
  let dirty = true;
  const generate = (directory: string) => {
    const result = spawnSync(process.execPath, [join(root, "marketing/build.mjs"), directory], { stdio: "inherit" });
    if (result.status !== 0) throw new Error("Marketing build failed");
  };
  const pages: Record<string, string> = { "/": "index.html", "/engineering": "engineering.html", "/learning": "learning.html" };
  return {
    name: "marketing-pages",
    configResolved(config) {
      root = config.root;
      output = resolve(root, config.build.outDir);
    },
    configureServer(server) {
      const devOutput = join(root, "node_modules/.cache/marketing");
      const sources = join(root, "marketing");
      server.watcher.add(sources);
      server.watcher.on("all", (_event, file) => {
        if (resolve(file).startsWith(sources + sep)) dirty = true;
      });
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url || "/", "http://localhost");
        const page = pages[url.pathname];
        const asset = /^\/marketing\/[a-z0-9.-]+$/.test(url.pathname);
        const discovery = ["/robots.txt", "/sitemap.xml"].includes(url.pathname);
        if (page || asset || discovery) {
          try {
            if (dirty) { generate(devOutput); dirty = false; }
            const file = page || url.pathname.slice(1);
            const content = readFileSync(join(devOutput, file));
            res.setHeader("Content-Type", file.endsWith(".html") ? "text/html; charset=utf-8"
              : file.endsWith(".woff2") ? "font/woff2" : file.endsWith(".xml") ? "application/xml" : "text/plain; charset=utf-8");
            res.end(content);
          } catch (error) { next(error); }
          return;
        }
        // Leave assets and Vite's internal requests alone; app navigations use app.html.
        if ((req.method === "GET" || req.method === "HEAD") && req.headers.accept?.includes("text/html")
          && !url.pathname.includes(".")) req.url = `/app.html${url.search}`;
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = new URL(req.url || "/", "http://localhost");
        if (pages[url.pathname]) req.url = `/${pages[url.pathname]}${url.search}`;
        else if (req.headers.accept?.includes("text/html") && !url.pathname.includes(".")) req.url = `/app.html${url.search}`;
        next();
      });
    },
    closeBundle() { generate(output); },
  };
}
