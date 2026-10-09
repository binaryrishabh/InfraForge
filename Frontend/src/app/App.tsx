import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import { useEffect } from "react";

// Existing Pages
import { CanvasDesignerPage } from "../features/canvas/components/CanvasDesignerPage";

// New Pages & Components
import { LandingPage } from "../features/landing/pages/LandingPage";
import { SignInPage } from "../features/auth/pages/SignInPage";
import { SignUpPage } from "../features/auth/pages/SignUpPage";
import { DashboardPage } from "../features/dashboard/pages/DashboardPage";
import { ReportsStubPage } from "../features/dashboard/pages/ReportsStubPage";
import { SettingsStubPage } from "../features/dashboard/pages/SettingsStubPage";
import { NotFoundPage } from "../features/dashboard/pages/NotFoundPage";

// Shell & Guards
import { AppShell } from "../components/shell/AppShell";
import { ProtectedRoute } from "../components/shell/ProtectedRoute";
import { PublicOnlyRoute } from "../components/shell/PublicOnlyRoute";
import { useAuthStore } from "../features/auth/store/auth.store";

function App() {
  const hydrate = useAuthStore(s => s.hydrate);

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
      <Toaster
        position="top-right"
        offset={64}
        theme="dark"
        toastOptions={{
          style: {
            background: "#1C1F26",
            border: "1px solid #2A2E37",
            color: "#EDEEF0"
          }
        }}
      />
      <Routes>
        {/* Public Routes */}
        <Route path="/" element={<LandingPage />} />
        <Route element={<PublicOnlyRoute />}>
          <Route path="/signin" element={<SignInPage />} />
          <Route path="/signup" element={<SignUpPage />} />
        </Route>

        {/* Protected Routes */}
        <Route element={<ProtectedRoute />}>
          {/* App Shell Routes (left rail) */}
          <Route element={<AppShell />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/reports" element={<ReportsStubPage />} />
            <Route path="/reports/:deploymentId" element={<ReportsStubPage />} />
            <Route path="/settings" element={<SettingsStubPage />} />
          </Route>

          {/* Designer is fullscreen and chrome-free: its shell navigation
              lives in the top-right ShellMenu, not the rail. */}
          <Route path="/design" element={<CanvasDesignerPage />} />
        </Route>

        {/* 404 */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
