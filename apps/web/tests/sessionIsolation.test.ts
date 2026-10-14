import { afterEach, expect, mock, test } from "bun:test";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
} });
const user = (id: string) => ({ id, name: id, email: `${id}@infraforge.test`, createdAt: new Date(0) });
const response = (id: string) => ({ data: { user: user(id) }, error: null });
let readSession = async (): Promise<unknown> => response("alice");
let logout = async (): Promise<unknown> => ({ error: null });
let credentialResult = { error: null as { code: string; status: number } | null };
const credentialSignIn = mock(async () => credentialResult);
const emailSignUp = mock(async () => credentialResult);
mock.module("../src/features/auth/sessionClient", () => ({ authClient: {
  getSession: () => readSession(), signOut: () => logout(), $fetch: credentialSignIn, signIn: { social: mock() }, signUp: { email: emailSignUp },
} }));
const { useAuthStore } = await import("../src/features/auth/store/auth.store");
const { useCanvasStore } = await import("../src/features/canvas/store/canvasStore");
const { useSimulationStore } = await import("../src/features/monitoring/store/simulationStore");
const { draftKey } = await import("../src/features/auth/drafts");
const { http } = await import("../src/client/httpClient");

afterEach(() => { useAuthStore.getState().expire(); storage.clear(); });

test("native credential success hydrates the real session and both namespaces share isolation", async () => {
  credentialResult = { error: null };
  readSession = async () => response("credential-user");
  await useAuthStore.getState().signUp({ username: "Learner", email: "learner@example.test", password: "opaque-test-value" });
  expect(useAuthStore.getState().user?.id).toBe("credential-user");
  await useAuthStore.getState().signInCredentials("LEARNER@example.test", "opaque-test-value");
  expect(credentialSignIn).toHaveBeenCalled();
  await useAuthStore.getState().signInCredentials("Learner", "opaque-test-value");
  expect(credentialSignIn).toHaveBeenCalledTimes(2);
  credentialResult = { error: { code: "INVALID_USERNAME_OR_PASSWORD", status: 401 } };
  await expect(useAuthStore.getState().signInCredentials("Absent", "opaque-test-value")).rejects.toThrow("Username, email or password is incorrect.");
  credentialResult = { error: null };
});

test("changing server identity clears canvas, saved layouts, modals and telemetry", async () => {
  readSession = async () => response("alice");
  await useAuthStore.getState().hydrate();
  useCanvasStore.setState({ currentLayoutName: "Alice private design", isInitialized: true,
    modalState: { type: "save" }, modalLoading: true, showLayoutDropdown: true });
  useSimulationStore.setState({ simulatedSeconds: 42 });
  storage.set(draftKey("alice"), "alice draft");
  storage.set(draftKey("bob"), "bob draft");
  storage.set("infraforge_auth_registry", "old passwords");
  readSession = async () => response("bob");
  await useAuthStore.getState().hydrate();
  expect(useAuthStore.getState().user?.id).toBe("bob");
  expect(useCanvasStore.getState()).toMatchObject({ currentLayoutName: null, isInitialized: false,
    modalState: null, modalLoading: false, showLayoutDropdown: false, savedLayouts: [] });
  expect(useSimulationStore.getState().simulatedSeconds).toBe(0);
  expect(storage.has("infraforge_auth_registry")).toBe(false);
  expect(storage.get(draftKey("alice"))).toBe("alice draft");
  expect(storage.get(draftKey("bob"))).toBe("bob draft");
});

test("a stale session response cannot restore identity after expiry", async () => {
  let resolve!: (value: unknown) => void;
  readSession = () => new Promise((done) => { resolve = done; });
  const hydration = useAuthStore.getState().hydrate();
  useAuthStore.getState().expire();
  resolve(response("alice"));
  await hydration;
  expect(useAuthStore.getState()).toMatchObject({ user: null, status: "guest" });
});

test("session failures hide protected state and failed sign-out is not reported as success", async () => {
  readSession = async () => response("alice");
  await useAuthStore.getState().hydrate();
  logout = async () => ({ error: { message: "unavailable" } });
  await expect(useAuthStore.getState().signOut()).rejects.toThrow("Sign-out could not be confirmed");
  expect(useAuthStore.getState().status).toBe("authenticated");
  readSession = async () => ({ data: null, error: { message: "unavailable" } });
  await useAuthStore.getState().hydrate();
  expect(useAuthStore.getState()).toMatchObject({ user: null, status: "error" });
  logout = async () => ({ error: null });
});

test("account changes cancel old API responses before they can populate the new account", async () => {
  readSession = async () => response("alice");
  await useAuthStore.getState().hydrate();
  let finish!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => { started = resolve; });
  const request = http.get("/fixture", { adapter: async (config) => {
    started();
    await new Promise<void>((resolve) => { finish = resolve; });
    return { config, data: "Alice private response", headers: {}, status: 200, statusText: "OK" };
  } }).then(() => "delivered", () => "cancelled");
  await waiting;
  readSession = async () => response("bob");
  await useAuthStore.getState().hydrate();
  finish();
  expect(await request).toBe("cancelled");
});
