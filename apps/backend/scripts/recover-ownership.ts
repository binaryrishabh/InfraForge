import { z } from "zod";
import { prisma } from "../lib/prisma";
import { recoverOwnership } from "../auth/recoverOwnership";

const args = process.argv.slice(2);
const value = (flag: string) => args[args.indexOf(flag) + 1];
const allowed = new Set(["--design", "--user", "--legacy-user", "--evidence", "--apply"]);
for (let i = 0; i < args.length; i++) {
  if (!allowed.has(args[i]!)) throw new Error("Unknown argument");
  if (args[i] !== "--apply") i++;
}
try {
  const input = z.object({ designId: z.string().uuid(), userId: z.string().min(1),
    expectedLegacyUserId: z.string().min(1), evidence: z.string().min(1), apply: z.boolean() }).parse({
    designId: args.includes("--design") ? value("--design") : undefined,
    userId: args.includes("--user") ? value("--user") : undefined,
    expectedLegacyUserId: args.includes("--legacy-user") ? value("--legacy-user") : undefined,
    evidence: args.includes("--evidence") ? value("--evidence") : undefined,
    apply: args.includes("--apply"),
  });
  console.log(JSON.stringify(await recoverOwnership(prisma, input), null, 2));
} finally { await prisma.$disconnect(); }
