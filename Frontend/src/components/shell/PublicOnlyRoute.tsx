import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '@/features/auth/store/auth.store';

export function PublicOnlyRoute() {
  const { status } = useAuthStore();

  if (status === 'hydrating') {
    return (
      <div className="h-screen w-screen bg-[#0f1117] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <span className="text-2xl">⚡</span>
          <span className="text-sm text-[#677185] tracking-wide">InfraForge</span>
        </div>
      </div>
    );
  }

  if (status === 'authenticated') {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}