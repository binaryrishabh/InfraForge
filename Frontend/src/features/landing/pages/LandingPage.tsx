import { Link } from 'react-router-dom';
import { useAuthStore } from '@/features/auth/store/auth.store';

export function LandingPage() {
  const status = useAuthStore(s => s.status);

  return (
    <div className="min-h-screen bg-[#0f1117] text-[#EDF1F7] flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-8">
        <div className="flex items-center justify-center gap-2 mb-4">
          <span className="text-3xl">⚡</span>
          <span className="text-2xl font-semibold tracking-wide">InfraForge</span>
        </div>
        <p className="text-[#AAB4C5] text-lg">
          Cloud infrastructure simulation playground.
        </p>
        
        {status === 'authenticated' ? (
          <Link
            to="/dashboard"
            className="inline-flex h-10 px-6 rounded-lg bg-[#5B8CFF] text-[13px] font-medium text-[#081018] hover:bg-[#7AA2FF] active:scale-[0.99] transition-all duration-150 items-center justify-center"
          >
            Open dashboard
          </Link>
        ) : (
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              to="/signin"
              className="inline-flex h-10 px-6 rounded-lg border border-[#273042] text-[13px] font-medium text-[#AAB4C5] hover:bg-[#171C27] hover:border-[#35415A] transition-all duration-150 items-center justify-center"
            >
              Sign in
            </Link>
            <Link
              to="/signup"
              className="inline-flex h-10 px-6 rounded-lg bg-[#5B8CFF] text-[13px] font-medium text-[#081018] hover:bg-[#7AA2FF] active:scale-[0.99] transition-all duration-150 items-center justify-center"
            >
              Get started
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}