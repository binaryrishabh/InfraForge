import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout';
import { useAuthStore } from '../store/auth.store';

export function SignInPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn } = useAuthStore();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const returnTo = (location.state as any)?.returnTo || '/dashboard';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signIn(email, password);
      navigate(returnTo, { replace: true });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-[#EDF1F7] mb-2">Sign in</h1>
        <p className="text-sm text-[#677185]">Welcome back to the forge.</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-xs font-medium text-[#AAB4C5] mb-1.5">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full h-10 rounded-lg bg-[#0B0E14] border border-[#273042] text-[13px] text-[#EDF1F7] px-3 outline-none focus:border-[#5B8CFF] focus:shadow-[0_0_0_3px_rgba(91,140,255,0.18)] transition-colors duration-150"
            placeholder="you@domain.com"
          />
        </div>
        <div>
          <div className="flex justify-between items-center mb-1.5">
            <label className="block text-xs font-medium text-[#AAB4C5]">Password</label>
          </div>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-10 rounded-lg bg-[#0B0E14] border border-[#273042] text-[13px] text-[#EDF1F7] px-3 pr-10 outline-none focus:border-[#5B8CFF] focus:shadow-[0_0_0_3px_rgba(91,140,255,0.18)] transition-colors duration-150"
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#677185] hover:text-[#AAB4C5]"
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
        </div>

        {error && (
          <div className="text-xs text-[#F0564A] bg-[rgba(240,86,74,0.08)] border border-[rgba(240,86,74,0.25)] rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full h-10 rounded-lg bg-[#5B8CFF] text-[13px] font-medium text-[#081018] hover:bg-[#7AA2FF] active:scale-[0.99] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading && <span className="w-3.5 h-3.5 border-2 border-[#081018]/30 border-t-[#081018] rounded-full animate-spin" />}
          Sign in
        </button>
      </form>
      <p className="mt-6 text-center text-xs text-[#677185]">
        No account yet?{' '}
        <Link to="/signup" className="text-[#5B8CFF] hover:underline">Create one</Link>
      </p>
      <p className="mt-4 text-center text-[10px] text-[#677185]">
        Local mode — your account lives in this browser for now. Cloud sync arrives soon.
      </p>
    </AuthLayout>
  );
}