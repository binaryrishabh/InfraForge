import { Settings } from 'lucide-react';

export function SettingsStubPage() {
  return (
    <div className="flex-1 flex items-center justify-center bg-[#0f1117]">
      <div className="text-center space-y-4">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-[#12161F] border border-[#273042] flex items-center justify-center text-[#677185]">
          <Settings size={24} />
        </div>
        <h2 className="text-lg font-semibold text-[#EDF1F7]">Settings</h2>
        <p className="text-sm text-[#677185] max-w-xs mx-auto">
          Profile, preferences, and Solana billing arrive in Era 2.
        </p>
      </div>
    </div>
  );
}