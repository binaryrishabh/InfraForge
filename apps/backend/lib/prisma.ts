import { PrismaClient } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { config } from "../utils/config"
import { databasePoolPolicy, operationalWarning } from "../utils/connectionPolicy";

const pool = new Pool({
    ...databasePoolPolicy,
    connectionString: config.DATABASE_URL
})
pool.on("error", operationalWarning("Database idle connection failed; pool will replace it."));

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({
    adapter
})

export { prisma }
