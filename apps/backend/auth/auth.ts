import { prisma } from "../lib/prisma";
import "../utils/config";
import { createAuth } from "./createAuth";
import { readAuthSettings } from "./settings";
import { commandRedis } from "../infra/redis";
import { RedisAccountQuota } from "./accountPolicy";
import { AccountEmailRequests } from "./mailRequests";

export const authSettings = readAuthSettings(process.env);
export const accountQuota = new RedisAccountQuota(commandRedis, authSettings.secret);
export const emailOutbox = authSettings.accountEssentials.emailEnabled && authSettings.accountEssentials.email
  ? new AccountEmailRequests(prisma, authSettings.accountEssentials.email, authSettings) : undefined;
export const auth = createAuth(prisma, authSettings, accountQuota, emailOutbox);
