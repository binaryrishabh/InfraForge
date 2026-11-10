import { z } from "zod";
export const GatewayQuotaSchema = z.object({profile: z.literal("gateway-quota/1"), scope: z.enum(["shared", "per-route"])}).strict();
