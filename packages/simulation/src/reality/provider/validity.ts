export function timestamp(value: string): number {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|\+00:00)$/.test(value) || !Number.isFinite(Date.parse(value))) throw Error("Explicit UTC timestamp required");

  const result = Date.parse(value);

  if (new Date(result).toISOString().slice(0, 19) !== value.slice(0, 19)) throw Error("Invalid calendar timestamp");

  return result;
}
export function bounded(value: unknown) {
  const stack: Array<{
    value: unknown;

    depth: number
  }> = [{ value, depth: 0 }];

  let fields = 0;

  while (stack.length) {
    const next = stack.pop()!;

    if (++fields > 50000 || next.depth > 24) throw Error("Provider contract field/depth budget");

    const v = next.value;

    if (typeof v === "string" && v.length > 4096 || typeof v === "number" && !Number.isFinite(v)) throw Error("Provider contract text/number budget");

    if (v && typeof v === "object") for (const child of Object.values(v)) stack.push({ value: child, depth: next.depth + 1 });
  }
}
