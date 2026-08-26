import { create } from 'zustand';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

interface LocalUserRecord {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

interface AuthState {
  user: SessionUser | null;
  status: "hydrating" | "authenticated" | "guest";
  hydrate: () => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

// Placeholder contract: SHA-256 hashing until real backend auth lands.
async function hashPassword(password: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function getRegistry(): LocalUserRecord[] {
  const raw = localStorage.getItem('infraforge_auth_registry');
  return raw ? JSON.parse(raw) : [];
}

function saveRegistry(registry: LocalUserRecord[]) {
  localStorage.setItem('infraforge_auth_registry', JSON.stringify(registry));
}

function getSessionUserId(): string | null {
  const raw = localStorage.getItem('infraforge_auth_session');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed.userId || null;
  } catch {
    return null;
  }
}

function saveSessionUserId(userId: string) {
  localStorage.setItem('infraforge_auth_session', JSON.stringify({ userId }));
}

function clearSession() {
  localStorage.removeItem('infraforge_auth_session');
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  status: "hydrating",

  hydrate: async () => {
    const userId = getSessionUserId();
    if (!userId) {
      set({ status: "guest", user: null });
      return;
    }
    const registry = getRegistry();
    const record = registry.find(r => r.id === userId);
    if (record) {
      set({
        status: "authenticated",
        user: {
          id: record.id,
          name: record.name,
          email: record.email,
          createdAt: record.createdAt
        }
      });
    } else {
      clearSession();
      set({ status: "guest", user: null });
    }
  },

  signUp: async (name, email, password) => {
    const registry = getRegistry();
    const normalizedEmail = email.toLowerCase();
    if (registry.some(r => r.email === normalizedEmail)) {
      throw new Error("An account with this email already exists.");
    }
    const passwordHash = await hashPassword(password);
    const newUser: LocalUserRecord = {
      id: crypto.randomUUID(),
      name,
      email: normalizedEmail,
      passwordHash,
      createdAt: new Date().toISOString()
    };
    registry.push(newUser);
    saveRegistry(registry);
    saveSessionUserId(newUser.id);
    set({
      status: "authenticated",
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        createdAt: newUser.createdAt
      }
    });
  },

  signIn: async (email, password) => {
    const registry = getRegistry();
    const normalizedEmail = email.toLowerCase();
    const record = registry.find(r => r.email === normalizedEmail);
    if (!record) {
      throw new Error("No account found with this email.");
    }
    const passwordHash = await hashPassword(password);
    if (record.passwordHash !== passwordHash) {
      throw new Error("Incorrect password.");
    }
    saveSessionUserId(record.id);
    set({
      status: "authenticated",
      user: {
        id: record.id,
        name: record.name,
        email: record.email,
        createdAt: record.createdAt
      }
    });
  },

  signOut: async () => {
    clearSession();
    set({ status: "guest", user: null });
  }
}));