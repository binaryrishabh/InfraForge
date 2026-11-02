export function workloadDynamicsError(value: unknown): string | null {
  if (value === undefined) return null;
  const error = "Workload dynamics requires version 1, even or poisson arrivals, and finite application CPU CV from 0 to 1 (1 is exponential service time).";
  if (!value || typeof value !== "object" || Array.isArray(value)) return error;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !["version", "arrivalProcess", "applicationCpuCv"].includes(k)) || v.version !== 1 ||
    (v.arrivalProcess !== "even" && v.arrivalProcess !== "poisson") || typeof v.applicationCpuCv !== "number" ||
    !Number.isFinite(v.applicationCpuCv) || v.applicationCpuCv < 0 || v.applicationCpuCv > 1) return error;
  return null;
}
