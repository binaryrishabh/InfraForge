import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuthStore } from "@/features/auth/store/auth.store";
import { BrandMark } from "@/ui/Brand";
import { Button } from "@/ui/Button";

export function SessionCheck() {
  return (
    <div role="status" aria-live="polite" className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-bg text-ink-3">
      <BrandMark size={28} className="text-ink if-pulse" />
      <span className="text-sm">Checking your session…</span>
    </div>
  );
}

export function ProtectedRoute() {
  const { status, user } = useAuthStore();
  const location = useLocation();
  if (status === "error") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-bg px-4 text-center text-ink">
        <p role="alert" className="text-[15px]">Your session could not be checked. The server may be unavailable.</p>
        <Button variant="primary" onClick={() => void useAuthStore.getState().hydrate()}>Try again</Button>
      </div>
    );
  }
  if (status === "hydrating") return <SessionCheck />;
  if (status === "guest") return <Navigate to="/signin" state={{ returnTo: location.pathname + location.search }} replace />;
  return <Outlet key={user?.id} />;
}
