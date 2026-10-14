import { afterEach, expect, spyOn, test } from "bun:test";
import { AxiosHeaders } from "axios";
import { http } from "../src/client/httpClient";
import { useAuthStore } from "../src/features/auth/store/auth.store";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { refreshDesignIdentity } from "../src/features/canvas/designIdentity";

const owner = (id: string) => ({ id, name: id, username: null, email: `${id}@infraforge.test`, emailVerified: true, createdAt: new Date(0).toISOString() });
const design = { id: "workspace", challengeId: "headroom-under-cpu-pressure", challengeVersion: 1 };
afterEach(() => { useCanvasStore.getState().clearCanvas(); useAuthStore.setState({ user: null, status: "guest" }); });

test("reopening the same challenge workspace after a freeform rerun restores identity while preserving unsaved edits", async () => {
  useAuthStore.setState({ user: owner("alice"), status: "authenticated" });
  const resources = [{ id: "edited", type: "DNS" as const, x: 10, y: 20 }];
  useCanvasStore.setState({ currentLayoutId: "workspace", currentChallengeId: null, currentChallengeVersion: null,
    currentLayoutSaved: false, resources });
  const read = spyOn(http, "get").mockResolvedValue({ data: { infrastructure: design } });
  try {
    await refreshDesignIdentity("workspace");
    const state = useCanvasStore.getState();
    expect(state.currentChallengeId).toBe(design.challengeId); expect(state.currentChallengeVersion).toBe(1);
    expect(state.resources).toBe(resources); expect(state.currentLayoutSaved).toBe(false);
  } finally { read.mockRestore(); }
});

test("a delayed identity response cannot relabel another account, another design or an active run", async () => {
  for (const change of ["account", "design", "run"] as const) {
    useCanvasStore.getState().clearCanvas();
    useAuthStore.setState({ user: owner("alice"), status: "authenticated" });
    useCanvasStore.setState({ currentLayoutId: "workspace", currentChallengeId: null });
    let reply!: (value: Awaited<ReturnType<typeof http.get>>) => void;
    const response = new Promise<Awaited<ReturnType<typeof http.get>>>((resolve) => { reply = resolve; });
    const read = spyOn(http, "get").mockReturnValue(response);
    try {
      const pending = refreshDesignIdentity("workspace");
      if (change === "account") useAuthStore.setState({ user: owner("bob") });
      else if (change === "design") useCanvasStore.setState({ currentLayoutId: "other" });
      else useCanvasStore.setState({ activeDeploymentId: "new-run" });
      reply({ data: { infrastructure: design }, status: 200, statusText: "OK", headers: {}, config: { headers: new AxiosHeaders() } }); await pending;
      expect(useCanvasStore.getState().currentChallengeId).toBeNull();
    } finally { read.mockRestore(); }
  }
});
