import { prisma } from "../lib/prisma";
import "../utils/config";
import { createAuth } from "./createAuth";
import { readAuthSettings } from "./settings";

export const authSettings = readAuthSettings(process.env);
export const auth = createAuth(prisma, authSettings);
