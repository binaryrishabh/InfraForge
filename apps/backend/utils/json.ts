import type { Prisma } from "../lib/generated/prisma/client";

// Snapshot interfaces have optional fields; persist plain JSON, never undefined properties.
export function storedJson(value: object): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value));
}
