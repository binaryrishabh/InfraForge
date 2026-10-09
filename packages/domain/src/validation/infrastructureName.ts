export const INFRASTRUCTURE_NAME_MAX_LENGTH = 30;

export function validateInfrastructureName(value: string): string | null {
  const length = value.trim().length;
  if (length < 3) return "Name must be at least 3 characters";
  if (length > INFRASTRUCTURE_NAME_MAX_LENGTH) return `Name must be at most ${INFRASTRUCTURE_NAME_MAX_LENGTH} characters`;
  return null;
}
