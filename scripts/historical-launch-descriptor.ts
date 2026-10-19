import { parse } from "acorn";
import { historicalImportDescriptor } from "./historical-import-descriptor";
import type { SourceTree } from "../apps/backend/executionIdentity/sourceTree";
interface Node { type: string; [key:string]: unknown }
// Frozen static launch-data decoder for the committed host-boundary descriptor.
export function historicalLaunchDescriptor(tree: SourceTree, runtime: string) {
  const base = historicalImportDescriptor(tree, runtime);
  const source = new Bun.Transpiler({loader:"ts",target:"bun"}).transformSync(tree.read("apps/backend/executionIdentity/launch.ts"));
  const ast = parse(source,{ecmaVersion:"latest",sourceType:"module"}) as unknown as Node;
  function value(node: Node): unknown {
    if (node.type === "Literal") return node.value;
    if (node.type === "UnaryExpression" && node.operator === "!") return !value(node.argument as Node);
    if (node.type === "ArrayExpression") return (node.elements as Node[]).map(value);
    if (node.type === "ObjectExpression") return Object.fromEntries((node.properties as Node[]).map(property => {
      const key=property.key as Node;
      if (property.type !== "Property" || property.computed || property.method || !["Identifier","Literal"].includes(key.type)) throw Error("Unreviewed historical launch data");
      return [String(key.name ?? key.value),value(property.value as Node)];
    }));
    throw Error("Nonliteral historical launch data");
  }
  for (const statement of ast.body as Node[]) {
    if (statement.type !== "ExportNamedDeclaration") continue;
    const declaration=statement.declaration as Node | undefined;
    if (declaration?.type !== "VariableDeclaration") continue;
    for (const item of declaration.declarations as Node[]) if ((item.id as Node).name === "launchContract") return {...base,settings:{...base.settings,launch:value(item.init as Node)}};
  }
  throw Error("Missing historical launch contract");
}
