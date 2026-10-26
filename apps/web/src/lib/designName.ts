export function defaultDesignName(name: string) {
  return name.trim() || `design-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}`;
}
