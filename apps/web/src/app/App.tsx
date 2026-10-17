import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { Toaster } from "sonner";
import { Analytics } from "@vercel/analytics/react";
import { LandingPage } from "../features/landing/pages/LandingPage";
import { SignInPage } from "../features/auth/pages/SignInPage";
import { HomePage } from "../features/dashboard/pages/HomePage";
import { NotFoundPage } from "../features/dashboard/pages/NotFoundPage";
import { ChallengesPage } from "../features/challenges/pages/ChallengesPage";
import { ChallengeDetailPage } from "../features/challenges/pages/ChallengeDetailPage";
import { DesignsPage } from "../features/designs/DesignsPage";
import { RunHistoryPage } from "../features/reports/pages/RunHistoryPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { AppShell } from "../components/shell/AppShell";
import { ProtectedRoute } from "../components/shell/ProtectedRoute";
import { PublicOnlyRoute } from "../components/shell/PublicOnlyRoute";
import { useAuthStore } from "../features/auth/store/auth.store";
import { resolvedTheme, usePreferences } from "./preferences";
import { Loading } from "../ui/Page";

// The designer and the evidence views carry most of the code; they load on first visit.
const CanvasDesignerPage = lazy(() => import("../features/canvas/components/CanvasDesignerPage").then((m) => ({ default: m.CanvasDesignerPage })));
const RunReportPage = lazy(() => import("../features/reports/pages/RunReportPage").then((m) => ({ default: m.RunReportPage })));
const ComparePage = lazy(() => import("../features/reports/pages/ComparePage").then((m) => ({ default: m.ComparePage })));
const InternalWorkspace = lazy(() => import("../features/internalModel2/InternalWorkspace").then((m) => ({ default: m.InternalWorkspace })));
const InternalLesson = lazy(() => import("../features/internalLessons/InternalLesson").then((m) => ({ default: m.InternalLesson })));

// Older links keep working: /dashboard and /reports moved to /home and /runs.
function LegacyReport() {
  const { deploymentId = "" } = useParams();
  return <Navigate to={`/runs/${encodeURIComponent(deploymentId)}`} replace />;
}
function LegacyCompare() {
  const { search } = useLocation();
  return <Navigate to={`/runs/compare${search}`} replace />;
}

function ThemedToaster() {
  const theme = usePreferences((s) => s.theme);
  return <Toaster position="bottom-right" theme={resolvedTheme(theme) === "ink" ? "dark" : "light"} closeButton
    toastOptions={{ style: { background: "var(--if-raised)", border: "1px solid var(--if-line-strong)", color: "var(--if-ink)", borderRadius: "6px", fontFamily: "var(--font-sans)" } }} />;
}

function App() {
  const hydrate = useAuthStore((s) => s.hydrate);
  useEffect(() => {
    void hydrate();
    const refresh = () => { void hydrate(); };
    const expire = () => useAuthStore.getState().expire();
    window.addEventListener("focus", refresh);
    window.addEventListener("infraforge:session-ended", expire);
    const interval = setInterval(refresh, 60000);
    const channel = new BroadcastChannel("infraforge-session");
    channel.onmessage = refresh;
    return () => {
      clearInterval(interval); channel.close();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("infraforge:session-ended", expire);
    };
  }, [hydrate]);

  return (
    <BrowserRouter>
      <ThemedToaster />
      <Analytics />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route element={<PublicOnlyRoute />}>
          <Route path="/signin" element={<SignInPage key="signin" />} />
          <Route path="/signup" element={<SignInPage key="signup" mode="signup" />} />
        </Route>
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route path="/home" element={<HomePage />} />
            <Route path="/challenges" element={<ChallengesPage />} />
            <Route path="/challenges/:challengeId" element={<ChallengeDetailPage />} />
            <Route path="/designs" element={<DesignsPage />} />
            <Route path="/runs" element={<RunHistoryPage />} />
            <Route path="/runs/compare" element={<ComparePage />} />
            <Route path="/runs/:deploymentId" element={<RunReportPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/internal/model2" element={<InternalWorkspace />} />
            <Route path="/internal/model2/learn" element={<InternalLesson />} />
          </Route>
          {/* The designer and live runs are full-screen workspaces with their own bar. */}
          <Route path="/design" element={<Suspense fallback={<div className="grid h-dvh place-items-center bg-canvas"><Loading label="Opening the designer…" /></div>}><CanvasDesignerPage /></Suspense>} />
          <Route path="/dashboard" element={<Navigate to="/home" replace />} />
          <Route path="/reports" element={<Navigate to="/runs" replace />} />
          <Route path="/reports/compare" element={<LegacyCompare />} />
          <Route path="/reports/:deploymentId" element={<LegacyReport />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
