import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import { useEffect } from "react";

// Existing Pages
import { CanvasDesignerPage } from "../features/canvas/components/CanvasDesignerPage";
import { MonitoringDashboard } from "../features/monitoring/components/MonitoringDashboard";

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
    hydrate();
  }, [hydrate]);

  return (
    <BrowserRouter>
      <Toaster
        position="top-right"
        offset={64}
        theme="dark"
        toastOptions={{
          style: {
            background: "#12161F",
            border: "1px solid #273042",
            color: "#EDF1F7"
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
          {/* App Shell Routes */}
          <Route element={<AppShell />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/design" element={<CanvasDesignerPage />} />
            <Route path="/reports" element={<ReportsStubPage />} />
            <Route path="/reports/:deploymentId" element={<ReportsStubPage />} />
            <Route path="/settings" element={<SettingsStubPage />} />
          </Route>
          
          {/* Fullscreen Protected Routes (No Shell) */}
          <Route path="/deployments/:deploymentId" element={<MonitoringDashboard />} />
        </Route>

        {/* 404 */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;