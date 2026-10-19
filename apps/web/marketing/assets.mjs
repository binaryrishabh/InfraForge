import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fonts = join(dirname(fileURLToPath(import.meta.url)), "fonts");
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
