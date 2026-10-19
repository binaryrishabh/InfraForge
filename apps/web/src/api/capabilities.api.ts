import { useEffect, useState } from "react";
import type { CapabilityAvailability } from "@infraforge/contracts/deployment";
import { http, API_URL } from "../client/httpClient";

// Hints only. Every mutation is authorized again at the server side effect.
export function useCapabilityAvailability() {
  const [availability, setAvailability] = useState<CapabilityAvailability | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void http.get(`${API_URL}/deployments/capabilities`, { signal: controller.signal })
      .then(response => { if (!controller.signal.aborted) setAvailability(response.data.availability); }).catch(() => {});
    return () => controller.abort();
  }, []);
  return availability;
}
