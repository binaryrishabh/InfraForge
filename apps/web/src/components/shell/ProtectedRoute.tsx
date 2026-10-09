import { Navigate, useLocation, Outlet } from 'react-router-dom';
import { useAuthStore } from '@/features/auth/store/auth.store';

export function ProtectedRoute() {
  const { status, user } = useAuthStore();
  const location = useLocation();

  if (status === 'error') {
    return <div className="min-h-screen bg-[#0f1117] text-[#EDF1F7] flex flex-col items-center justify-center gap-4">
      <p role="alert">Your session could not be checked.</p>
      <button className="text-[#5B8CFF] underline" onClick={() => void useAuthStore.getState().hydrate()}>Try again</button>
    </div>;
  }

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

  if (status === 'guest') {
    return <Navigate to="/signin" state={{ returnTo: location.pathname }} replace />;
  }

  return <Outlet key={user?.id} />;
}
