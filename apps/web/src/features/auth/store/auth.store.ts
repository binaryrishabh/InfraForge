import { create } from "zustand";
import { authClient } from "../sessionClient";
import { clearOldBrowserAccounts } from "../drafts";
import { useCanvasStore } from "../../canvas/store/canvasStore";
import { useSimulationStore } from "../../monitoring/store/simulationStore";
import { cancelUserRequests } from "../../../client/httpClient";
import { credentialBody, CredentialError, type CredentialFields } from "../credentials";
import { completeEmailSignup } from "../accountClient";
import { asCredentialError } from "../accountFlow";

export interface SessionUser { id: string; name: string; username: string | null; email: string; emailVerified: boolean; createdAt: string }
interface AuthState {
  user: SessionUser | null;
  status: "hydrating" | "authenticated" | "guest" | "error";
  hydrate: () => Promise<void>;
  signIn: (provider: "google" | "github") => Promise<void>;
  signInCredentials: (identifier: string, password: string) => Promise<void>;
  signUp: (fields: CredentialFields, options?: { emailProof?: string }) => Promise<void>;
  signOut: () => Promise<void>;
  expire: () => void;
}
let generation = 0;
const resetUserState = () => {
  cancelUserRequests();
  useCanvasStore.getState().clearCanvas();
  useCanvasStore.getState().setIsInitialized(false);
  useCanvasStore.getState().setSavedLayouts([]);
  useCanvasStore.getState().setShowLayoutDropdown(false);
  useCanvasStore.getState().setModalState(null);
  useCanvasStore.getState().setModalLoading(false);
  useSimulationStore.getState().reset();
};
export const useAuthStore = create<AuthState>((set, get) => ({
  user: null, status: "hydrating",
  hydrate: async () => {
    const request = ++generation;
    clearOldBrowserAccounts();
    try {
      const { data, error } = await authClient.getSession();
      if (request !== generation) return;
      if (error) throw new Error("Session unavailable");
      if (data?.user.id !== get().user?.id) {
        resetUserState();
      }
      set({ user: data ? { id: data.user.id, name: data.user.name, email: data.user.email,
        username: data.user.username ?? null, emailVerified: data.user.emailVerified,
        createdAt: new Date(data.user.createdAt).toISOString() } : null,
        status: data ? "authenticated" : "guest" });
    } catch {
      if (request !== generation) return;
      resetUserState();
      set({ user: null, status: "error" });
    }
  },
  signIn: async (provider) => {
    const { error } = await authClient.signIn.social({ provider,
      callbackURL: `${window.location.origin}/home`, errorCallbackURL: `${window.location.origin}/signin` });
    if (error) throw new Error("Sign-in could not be started. Try again.");
  },
  signInCredentials: async (identifier, password) => {
    const { error } = await authClient.$fetch<unknown, { code?: string }>("/sign-in/identifier", { method: "POST", body: credentialBody(identifier, password) });
    if (error) throw new CredentialError(error.code, error.status);
    await get().hydrate();
    if (get().status !== "authenticated") throw new Error("Your session could not be loaded. Try signing in again.");
  },
  signUp: async ({ username, email, password }, options = {}) => {
    const input = { username, name: username, email: email.trim().toLowerCase(), password };
    try {
      if (options.emailProof) await completeEmailSignup({ ...input, emailProof: options.emailProof });
      else {
        const { error } = await authClient.signUp.email(input);
        if (error) throw new CredentialError(error.code, error.status);
      }
    } catch (error) { throw asCredentialError(error); }
    if (options.emailProof) {
      try { await get().signInCredentials(input.email, password); }
      catch { throw new CredentialError("SIGNUP_SIGNIN_FAILED"); }
      return;
    }
    await get().hydrate();
    if (get().status !== "authenticated") throw new Error("Your session could not be loaded. Try signing in again.");
  },
  signOut: async () => {
    const { error } = await authClient.signOut();
    if (error) throw new Error("Sign-out could not be confirmed. Try again.");
    get().expire();
    const channel = new BroadcastChannel("infraforge-session");
    channel.postMessage("signed-out");
    channel.close();
  },
  expire: () => {
    generation++;
    resetUserState();
    set({ user: null, status: "guest" });
  },
}));
