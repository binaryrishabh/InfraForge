import { RUN_CONTRACT } from "@infraforge/contracts/deployment";
import { API_URL, http } from "@/client/httpClient";

// Freeform runs expose interventions, so check before creating a server run.
// Do not cache: the backend may change between runs during a release.
export async function requireRunCompatibility(): Promise<void> {
  const response = await http.get(`${API_URL}/deployments/capabilities`).catch((cause: unknown) => {
    throw new Error("Could not check server compatibility. Check your connection or session, then reload and try again.", { cause });
  });
  const contract: unknown = response.data?.runContract;
  if (contract == null || (typeof contract === "number" && Number.isSafeInteger(contract) && contract < RUN_CONTRACT)) {
    throw new Error("This server does not support the required run version yet. Reload and try again shortly.");
  }
  if (typeof contract !== "number" || !Number.isSafeInteger(contract)) {
    throw new Error("The server returned an invalid run compatibility response. Reload and try again.");
  }
}
