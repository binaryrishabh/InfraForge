import * as z from "zod";
import { LayoutSchema } from "./layout.schema";
import { validateInfrastructureName } from "@infraforge/domain/validation";

const NameSchema = z.string().trim().superRefine((value, context) => {
  const message = validateInfrastructureName(value);
  if (message) context.addIssue({ code: "custom", message });
});

export const InfrastructureBodySchema = z.object({
  name: NameSchema,
  layout: LayoutSchema
})

export const UpdateInfrastructureBodySchema = z.object({
  name: NameSchema.optional(),
  layout: LayoutSchema.optional()
}).refine(
  (data) => data.name !== undefined || data.layout !== undefined,
  { message: "At least one field (name or layout) must be provided" }
)

export const InfrastructureIdSchema = z.object({
  infrastructureId: z.string().uuid("Invalid Infrastructure id format")
})

export type InfrastructureBodySchemaType = z.infer<typeof InfrastructureBodySchema>
export type UpdateInfrastructureBodySchema = z.infer<typeof UpdateInfrastructureBodySchema>
export type IdType = z.infer<typeof InfrastructureIdSchema>
