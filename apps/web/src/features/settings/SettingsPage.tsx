import { useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import { useAuthStore } from "@/features/auth/store/auth.store";
import { usePreferences } from "@/app/preferences";
import { Button } from "@/ui/Button";
import { Page, PageHeader, Section } from "@/ui/Page";
import { Segmented } from "@/ui/Segmented";
import { formatDate } from "@/lib/format";

/* Only settings that exist: appearance and density for this browser, and the
signed-in account. */
export function SettingsPage() {
  const navigate = useNavigate();
  const { user, signOut } = useAuthStore();
  const { theme, density, setTheme, setDensity } = usePreferences();
  const leave = async () => {
    try { await signOut(); navigate("/signin"); }
    catch { toast.error("Sign-out could not be confirmed. Try again."); }
  };
  return (
    <Page width="narrow">
      <PageHeader eyebrow="Settings" title="Settings" lede="Appearance and density are saved in this browser only." />
      <Section number={1} title="Appearance" className="mt-8">
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="text-sm font-medium text-ink">Theme</p><p className="text-xs text-ink-3">Live runs always use Ink so measurements read as an instrument.</p></div>
            <Segmented label="Theme" value={theme} onChange={setTheme} options={[{ value: "paper", label: "Paper" }, { value: "ink", label: "Ink" }, { value: "system", label: "Match system" }]} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="text-sm font-medium text-ink">Density</p><p className="text-xs text-ink-3">Compact tightens list rows, report sections and the live event log.</p></div>
            <Segmented label="Density" value={density} onChange={setDensity} options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} />
          </div>
          <p className="text-xs text-ink-3">Motion follows your operating system's reduced-motion setting.</p>
        </div>
      </Section>
      <Section number={2} title="Account" className="mt-10">
        {user && (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-ink-3">Name</dt><dd className="text-ink">{user.name}</dd></div>
            <div><dt className="text-xs text-ink-3">Email</dt><dd className="break-all text-ink">{user.email}</dd></div>
            <div><dt className="text-xs text-ink-3">Member since</dt><dd className="text-ink">{formatDate(user.createdAt)}</dd></div>
            <div><dt className="text-xs text-ink-3">Sign-in</dt><dd className="text-ink">Through your Google or GitHub account</dd></div>
          </dl>
        )}
        <Button className="mt-5" variant="secondary" icon={<LogOut size={15} aria-hidden="true" />} onClick={() => void leave()}>Sign out</Button>
      </Section>
    </Page>
  );
}
