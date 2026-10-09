import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="min-h-screen bg-[#0f1117] text-[#EDF1F7] flex flex-col items-center justify-center p-6">
      <div className="text-center space-y-6 max-w-sm">
        <h1 className="text-6xl font-semibold text-[#273042]">404</h1>
        <p className="text-[#AAB4C5]">This route was never provisioned.</p>
        <Link
          to="/"
          className="inline-flex h-9 px-4 rounded-lg bg-[#171C27] border border-[#273042] text-[13px] font-medium text-[#EDF1F7] hover:bg-[#232B3B] hover:border-[#35415A] transition-all duration-150 items-center justify-center"
        >
          Back to safety
        </Link>
      </div>
    </div>
  );
}