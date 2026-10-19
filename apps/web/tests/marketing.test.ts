import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

let output: string;
const page = (name: string) => readFileSync(join(output, `${name}.html`), "utf8");
beforeAll(() => {
  output = mkdtempSync(resolve(import.meta.dir, "../node_modules/infraforge-marketing-"));
  const result = spawnSync(process.execPath, [resolve(import.meta.dir, "../marketing/build.mjs"), output]);
  expect(result.status, result.stderr?.toString()).toBe(0);
}, 30000);
afterAll(() => { if (output) rmSync(output, { recursive: true, force: true }); });

test("marketing build emits three pages sharing exactly two external fonts", () => {
  expect(readdirSync(join(output, "marketing")).filter((file) => file.endsWith(".woff2"))).toHaveLength(2);
  for (const name of ["index", "engineering", "learning"]) {
    const html = page(name);
    expect(html).not.toContain("data:font/");
    for (const font of html.matchAll(/url\((\/marketing\/[^)]+\.woff2)\)/g)) {
      expect(readFileSync(join(output, font[1]!)).length).toBeGreaterThan(0);
    }
    expect(html).toContain('name="twitter:card" content="summary"');
    expect(html).not.toContain('property="og:image"');
    const url = `https://infraforge.lapwork.in/${name === "index" ? "" : name}`;
    expect(html).toContain(`<link rel="canonical" href="${url}">`);
    expect(html).toContain(`<meta property="og:url" content="${url}">`);
  }
});
test("structured data uses page-specific FAQ and breadcrumbs", () => {
  for (const name of ["engineering", "learning"]) {
    const html = page(name);
    const data = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]!);
    const faq = data["@graph"][0];
    expect(faq["@type"]).toBe("FAQPage");
    expect(faq.mainEntity.length).toBeGreaterThan(0);
    for (const item of faq.mainEntity) {
      expect(html).toContain(item.name);
      expect(html).toContain(item.acceptedAnswer.text);
    }
    expect(data["@graph"][1].itemListElement.map((item: { name: string }) => item.name)).toEqual(["Home", name === "engineering" ? "Engineering" : "Learning"]);
  }
});
test("hero metadata and discovery files describe only public marketing URLs", () => {
  expect(page("index")).toContain("<title>InfraForge: see exactly why your system breaks</title>");
  const robots = readFileSync(join(output, "robots.txt"), "utf8");
  for (const path of ["home", "design", "runs", "designs", "settings", "internal"]) expect(robots).toContain(`Disallow: /${path}\n`);
  expect(readFileSync(join(output, "sitemap.xml"), "utf8").match(/<loc>/g)).toHaveLength(3);
});
test("approved calls to action and footer links enter the intended routes", () => {
  expect(page("index")).toContain('href="/learning">I\'m learning');
  expect(page("index")).toContain('href="/engineering">I\'m engineering');
  expect(page("engineering")).toContain('href="/design">Open the canvas');
  expect(page("learning")).toContain('href="/challenges">Start learning');
  for (const name of ["engineering", "learning"]) {
    expect(page(name)).toContain('href="/learning#concepts">Concepts');
    expect(page(name)).toContain('href="/runs">Recorded runs');
  }
});
