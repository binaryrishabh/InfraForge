export interface SourceTree {
  paths: string[];
  read(path: string): string;
  resourceBytes?(path: string): string;
  resolveImport?(specifier: string, importer: string): string;
}
