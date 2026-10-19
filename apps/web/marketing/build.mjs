import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { emitFonts, emitOgImages } from "./assets.mjs";
import { addSeo, origin } from "./seo.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(process.argv[2] || join(here, "../dist"));
mkdirSync(output, { recursive: true });
emitFonts(output);
emitOgImages(output);
for (const [generator, page] of [["motion/hero.mjs", "index"], ["sections/engineering-site.mjs", "engineering"], ["sections/learning2.mjs", "learning"]]) {
  const result = spawnSync(process.execPath, [join(here, generator), output], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`Marketing generator failed: ${generator}`);
  const file = join(output, `${page}.html`);
  writeFileSync(file, addSeo(readFileSync(file, "utf8"), page).replaceAll("\r\n", "\n"));
}
writeFileSync(join(output, "robots.txt"), `User-agent: *\nAllow: /\n${["home", "design", "runs", "designs", "settings", "internal"].map((route) => `Disallow: /${route}`).join("\n")}\nSitemap: ${origin}/sitemap.xml\n`);
writeFileSync(join(output, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${["/", "/engineering", "/learning"].map((route) => `<url><loc>${origin}${route}</loc></url>`).join("")}\n</urlset>\n`);
