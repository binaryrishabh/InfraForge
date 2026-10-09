import { isAxiosError } from "axios";

export function errorMessage(error: unknown, fallback: string): string {
  if (isAxiosError<{ message?: unknown }>(error)) {
    const message = error.response?.data?.message;
    return typeof message === "string" && message ? message : fallback;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
