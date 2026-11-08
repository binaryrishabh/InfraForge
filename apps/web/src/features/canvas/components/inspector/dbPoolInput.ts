import { dbPoolError } from "@infraforge/domain/resource";

export function parseDbPool(text: string) {
  const value = text === "" ? undefined : Number(text);
  const error = text !== "" && text.trim() === "" ? "Enter a whole number from 1 to 512, or leave blank for 10." : dbPoolError("Database", value);
  return { value, error };
}
