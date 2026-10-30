import { RUN_CONTRACT } from "@infraforge/contracts/deployment";
import { API_URL, http } from "@/client/httpClient";

// Freeform runs expose interventions, so check before creating a server run.
// Do not cache: the backend may change between runs during a release.
export async function requireRunCompatibility(): Promise<void> {
  const response = await http.get(`${API_URL}/deployments/capabilities`).catch((cause: unknown) => {
    throw new Error("Server update in progress, try again shortly.", { cause });
  });
  const contract: unknown = response.data?.runContract;
  if (typeof contract !== "number" || !Number.isSafeInteger(contract) || contract < RUN_CONTRACT) {
    throw new Error("Server update in progress, try again shortly.");
  }
}
