import { prisma } from "../lib/prisma";
import "../utils/config";
import { createAuth } from "./createAuth";
import { readAuthSettings } from "./settings";
import { commandRedis } from "../infra/redis";
import { RedisAccountQuota } from "./accountPolicy";

export const authSettings = readAuthSettings(process.env);
export const accountQuota = new RedisAccountQuota(commandRedis, authSettings.secret);
export const auth = createAuth(prisma, authSettings, accountQuota);
