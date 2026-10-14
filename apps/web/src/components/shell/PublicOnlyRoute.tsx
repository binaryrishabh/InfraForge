import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore } from "@/features/auth/store/auth.store";
import { SessionCheck } from "./ProtectedRoute";

export function PublicOnlyRoute() {
  const { status } = useAuthStore();
  if (status === "hydrating") return <SessionCheck />;
  if (status === "authenticated") return <Navigate to="/home" replace />;
  return <Outlet />;
}
