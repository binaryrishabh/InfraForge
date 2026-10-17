import { readFile } from "node:fs/promises";
export function nginxConfig(template: string, domain: string, mode: string, cert = "", key = "") {
  if (domain.length > 253 || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain)) throw new Error("Exact DNS hostname required");
  if (mode === "http") return `# InfraForge managed site\nserver {\n    listen 80;\n    server_name ${domain};\n    location ^~ /.well-known/acme-challenge/ { root /var/lib/infraforge/acme; }\n    location / { return 503; }\n}\n`;
  if (mode !== "tls" || ![cert, key].every(path => /^\/[a-zA-Z0-9/_.-]+$/.test(path) && !path.split("/").includes(".."))) throw new Error("TLS requires explicit absolute certificate/key paths");
  return `# InfraForge managed site\n${template.replaceAll("DOMAIN", domain)
    .replaceAll("/etc/infraforge/tls/fullchain.pem", cert).replaceAll("/etc/infraforge/tls/privkey.pem", key)}`;
}
if (import.meta.main) {
  const [domain = "", mode = "", cert, key] = process.argv.slice(2);
  process.stdout.write(nginxConfig(await readFile(new URL("../nginx.conf.template", import.meta.url), "utf8"), domain, mode, cert, key));
}
