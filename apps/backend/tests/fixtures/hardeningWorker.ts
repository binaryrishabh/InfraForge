import { WorkerOwnership } from "../../infra/workerOwnership";
if (process.env.HARDENING_SERVICES !== "owned-local") throw new Error("Owned local fixture only");
const ownership = await WorkerOwnership.acquire("postgresql://postgres@hardening-postgres:5432/infraforge_hardening", () => process.exit(1));
process.stdout.write("OWNED\n");
setInterval(() => { void ownership.assertHeld().catch(() => process.exit(1)); }, 1000);
