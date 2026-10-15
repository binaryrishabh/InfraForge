import ts from "typescript";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";

export interface NumericSite { id: string; file: string; line: number; column: number; value: number; text: string; context: string; symbol: string }
const excluded = new Set(["node_modules", "tests", "dist", "generated", ".git"]);
export function auditFiles(root: string): string[] {
  const walk = (path: string): string[] => readdirSync(path, { withFileTypes: true }).flatMap((e) => {
    if (e.name.startsWith(".") || excluded.has(e.name)) return [];
    const full = join(path, e.name);
    const scoped = relative(root, full).replaceAll("\\", "/");
    if (["packages/simulation/src/model2", "packages/simulation/src/reality"].includes(scoped)) return [];
    return e.isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name) ? [full] : [];
  });
  return ["packages/domain/src", "packages/catalog/src", "packages/contracts/src", "packages/simulation/src", "apps/backend", "apps/web/src"]
    .flatMap((p) => walk(join(root, p))).map((p) => relative(root, p).replaceAll("\\", "/"))
    .sort();
}
export function scanFile(file: string, source: string): NumericSite[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true), sites: NumericSite[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isBigIntLiteral(node)) throw new Error(`BigInt assumption needs an explicit ledger representation: ${file}`);
    if (ts.isNumericLiteral(node)) {
      const position = tree.getLineAndCharacterOfPosition(node.getStart(tree));
      let context: ts.Node = node, symbol = "";
      for (let parent: ts.Node | undefined = node.parent; parent && !ts.isSourceFile(parent); parent = parent.parent) {
        if (ts.isPropertyAssignment(parent)) symbol = `${parent.name.getText(tree)}${symbol ? `.${symbol}` : ""}`;
        if (ts.isVariableDeclaration(parent) || ts.isFunctionDeclaration(parent)) { symbol = `${parent.name?.getText(tree) ?? "anonymous"}${symbol ? `.${symbol}` : ""}`; break; }
      }
      while (context.parent && !ts.isStatement(context) && !ts.isPropertyAssignment(context) && !ts.isSourceFile(context.parent)) context = context.parent;
      if (file.includes("/catalog/") && ts.isPropertyAssignment(context) && ts.isObjectLiteralExpression(context.parent)) context = context.parent;
      const text = ts.isPrefixUnaryExpression(node.parent) && node.parent.operator === ts.SyntaxKind.MinusToken ? node.parent.getText(tree) : node.getText(tree);
      sites.push({ id: `m1.${file.replace(/\.[^.]+$/, "").replaceAll("/", ".")}.${sites.length + 1}`, file,
        line: position.line + 1, column: position.character + 1, value: Number(text.replaceAll("_", "")), text,
        context: context.getText(tree).replace(/\s+/g, " ").slice(0, 500), symbol });
    }
    ts.forEachChild(node, visit);
  };
  visit(tree); return sites;
}
export function sourceDigest(source: string) { return createHash("sha256").update(source.replaceAll("\r\n", "\n")).digest("hex"); }
export function scanRepository(root: string) {
  return auditFiles(root).map((file) => {
    const source = readFileSync(join(root, file), "utf8");
    return { file, sha256: sourceDigest(source), sites: scanFile(file, source) };
  });
}
