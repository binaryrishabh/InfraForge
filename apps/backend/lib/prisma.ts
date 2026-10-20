import { PrismaClient } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { config } from "../utils/config"
import { databaseAdapterPolicy, databasePoolOptions, operationalWarning } from "../utils/connectionPolicy";

const pool = new Pool({
    ...databasePoolOptions(config.WORKER_DATABASE_MODE),
    connectionString: config.DATABASE_URL
})
pool.on("error", operationalWarning("Database idle connection failed; pool will replace it."));

const adapter = new PrismaPg(pool, databaseAdapterPolicy);
const prisma = new PrismaClient({
    adapter
})

export { prisma }
