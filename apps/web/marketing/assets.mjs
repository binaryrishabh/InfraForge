import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fonts = join(here, "fonts");
export const fontNames = ["inter-tight-latin-wght-normal.woff2", "geist-mono-latin-wght-normal.woff2"];
export function fontUrl(name) {
  const hash = createHash("sha256").update(readFileSync(join(fonts, name))).digest("hex").slice(0, 12);
  return `/marketing/${name.replace(".woff2", `.${hash}.woff2`)}`;
}
export function emitFonts(output) {
  mkdirSync(join(output, "marketing"), { recursive: true });
  for (const name of fontNames) copyFileSync(join(fonts, name), join(output, fontUrl(name)));
  for (const notice of ["inter-tight-OFL.txt", "geist-mono-OFL.txt"]) {
    copyFileSync(join(fonts, notice), join(output, "marketing", notice));
  }
}
// Approved link-preview images (1200x630), one per page, named by content so shares refresh when they change.
export const ogPages = ["index", "engineering", "learning"];
export function ogUrl(page) {
  const hash = createHash("sha256").update(readFileSync(join(here, "og", `${page}.png`))).digest("hex").slice(0, 12);
  return `/marketing/og-${page}.${hash}.png`;
}
export function emitOgImages(output) {
  mkdirSync(join(output, "marketing"), { recursive: true });
  for (const page of ogPages) copyFileSync(join(here, "og", `${page}.png`), join(output, ogUrl(page)));
}
