import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuthStore } from "@/features/auth/store/auth.store";
import { accountExport, deleteAccount } from "@/features/auth/accountClient";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, Input } from "@/ui/Field";
import { Notice, Section } from "@/ui/Page";
import { Tag } from "@/ui/Tag";
import { formatDate } from "@/lib/format";
import { activeSessions, connectProvider, loginMethods, revokeOtherSessions, revokeSession, unlinkMethod,
  type ActiveSession, type LoginMethod } from "./accountSettings.api";

const PROVIDERS = [
  { id: "credential", label: "Password" },
  { id: "google", label: "Google" },
  { id: "github", label: "GitHub" },
] as const;
const failed = (error: unknown, fallback: string) =>
  (error as { response?: { data?: { message?: string } } }).response?.data?.message ?? fallback;

/* Asks for the current password before a sensitive change. */
function PasswordDialog({ open, title, description, confirmLabel, danger, extra, onClose, onConfirm }: {
  open: boolean; title: string; description: ReactNode; confirmLabel: string; danger?: boolean; extra?: (ok: (v: boolean) => void) => ReactNode;
  onClose: () => void; onConfirm: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(!extra);
  const close = () => { setPassword(""); setReady(!extra); onClose(); };
  const submit = async () => {
    setBusy(true);
    try { await onConfirm(password); close(); }
    catch (error) { toast.error(failed(error, "That did not work. Check your password and try again.")); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }} title={title} description={description} busy={busy} guarded size="sm"
      footer={<><Button variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
        <Button variant={danger ? "danger" : "primary"} loading={busy} disabled={!password || !ready} onClick={() => void submit()}>{confirmLabel}</Button></>}>
      <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (password && ready) void submit(); }}>
        <Field label="Current password"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus /></Field>
        {extra?.(setReady)}
      </form>
    </Dialog>
  );
}

export function SignInMethodsSection() {
  const [methods, setMethods] = useState<LoginMethod[] | null | undefined>(undefined);
  const [removing, setRemoving] = useState<LoginMethod | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(() => { loginMethods().then((m) => { setError(false); setMethods(m); }, () => setError(true)); }, []);
  useEffect(load, [load]);
  const hasPassword = !!methods?.some((m) => m.providerId === "credential");
  return (
    <Section number={3} title="Sign-in methods" className="mt-10">
      {error ? <Notice tone="fail" role="alert">Sign-in methods could not be loaded. Reload to try again.</Notice>
        : methods === undefined ? <p role="status" className="text-sm text-ink-3">Loading…</p>
        : methods === null ? <p className="text-sm text-ink-2">Managing sign-in methods is not available yet.</p>
        : <ul className="flex flex-col divide-y divide-line">
          {PROVIDERS.map(({ id, label }) => {
            const linked = methods.find((m) => m.providerId === id);
            return (
              <li key={id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-ink">{label}</span>
                  {linked ? <Tag tone="ok">Connected</Tag> : <Tag>Not connected</Tag>}
                  {linked && <span className="text-xs text-ink-3">since {formatDate(linked.createdAt)}</span>}
                </div>
                {linked ? (hasPassword && <Button size="sm" variant="ghost" onClick={() => setRemoving(linked)}>Disconnect</Button>)
                  : id === "credential" ? <Link to="/forgot-password" className="text-sm text-accent">Set a password</Link>
                  : <Button size="sm" variant="secondary" onClick={() => void connectProvider(id).catch(() => toast.error(`${label} could not be connected. Try again.`))}>Connect</Button>}
              </li>
            );
          })}
        </ul>}
      {methods && !hasPassword && <p className="mt-3 text-xs text-ink-3">To disconnect a method or delete your account, first set a password with the reset link.</p>}
      <PasswordDialog open={!!removing} title="Disconnect this sign-in method?" confirmLabel="Disconnect"
        description="You can connect it again later. You always keep at least one way to sign in."
        onClose={() => setRemoving(null)}
        onConfirm={async (password) => { await unlinkMethod(removing!.id, password); toast.success("Disconnected."); load(); }} />
    </Section>
  );
}

export function deviceName(agent: string | null) {
  if (!agent) return "Unknown device";
  const browser = /Edg\//.test(agent) ? "Edge" : /Firefox\//.test(agent) ? "Firefox" : /Chrome\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : "Browser";
  const os = /Windows/.test(agent) ? "Windows" : /Android/.test(agent) ? "Android" : /iPhone|iPad/.test(agent) ? "iOS" : /Mac OS/.test(agent) ? "macOS" : /Linux/.test(agent) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

export function SessionsSection() {
  const [sessions, setSessions] = useState<ActiveSession[] | undefined>(undefined);
  const [unavailable, setUnavailable] = useState(false);
  const load = useCallback(() => { activeSessions().then(setSessions, () => setUnavailable(true)); }, []);
  useEffect(load, [load]);
  if (unavailable) return null;
  const act = async (work: () => Promise<void>, done: string) => {
    try { await work(); toast.success(done); load(); } catch { toast.error("That did not work. Try again."); }
  };
  return (
    <Section number={4} title="Where you're signed in" className="mt-10">
      {sessions === undefined ? <p role="status" className="text-sm text-ink-3">Loading…</p> : <>
        <ul className="flex flex-col divide-y divide-line">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="flex items-center gap-2 text-sm font-medium text-ink">{deviceName(s.userAgent)}{s.current && <Tag tone="accent">This device</Tag>}</p>
                <p className="text-xs text-ink-3">Signed in {formatDate(s.createdAt)}</p>
              </div>
              {!s.current && <Button size="sm" variant="ghost" onClick={() => void act(() => revokeSession(s.id), "Signed out that device.")}>Sign out</Button>}
            </li>
          ))}
        </ul>
        {sessions.length > 1 && <Button className="mt-4" variant="secondary" onClick={() => void act(revokeOtherSessions, "Signed out everywhere else.")}>Sign out everywhere else</Button>}
      </>}
    </Section>
  );
}

export function YourDataSection() {
  const navigate = useNavigate();
  const expire = useAuthStore((state) => state.expire);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const download = async () => {
    setExporting(true);
    try {
      const pages = [];
      for await (const page of accountExport()) pages.push(page);
      const url = URL.createObjectURL(new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), pages }, null, 2)], { type: "application/json" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: "infraforge-account-export.json" });
      a.click(); URL.revokeObjectURL(url);
    } catch (error) { toast.error(failed(error, "Your data could not be exported. Try again.")); }
    finally { setExporting(false); }
  };
  return (
    <Section number={5} title="Your data" className="mt-10">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-sm font-medium text-ink">Download your data</p><p className="text-xs text-ink-3">Designs, runs and reports as one JSON file.</p></div>
          <Button variant="secondary" loading={exporting} onClick={() => void download()}>Download</Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-sm font-medium text-ink">Delete your account</p><p className="text-xs text-ink-3">Removes your profile and signs you out everywhere. This cannot be undone.</p></div>
          <Button variant="danger" onClick={() => setDeleting(true)}>Delete account</Button>
        </div>
      </div>
      <PasswordDialog open={deleting} danger title="Delete your account?" confirmLabel="Delete forever"
        description="Your profile is erased and every session ends. Type DELETE to confirm."
        extra={(ok) => <Field label="Type DELETE"><Input onChange={(e) => ok(e.target.value === "DELETE")} autoComplete="off" /></Field>}
        onClose={() => setDeleting(false)}
        onConfirm={async (password) => { await deleteAccount(password, "DELETE"); expire(); navigate("/signin", { replace: true }); }} />
    </Section>
  );
}
