import type { ReactNode } from 'react';

interface AuthLayoutProps {
  children: ReactNode;
}

export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen bg-[#0f1117] text-[#EDF1F7]">
      {/* Left Panel */}
      <div className="hidden lg:flex w-1/2 flex-col justify-between p-12 bg-[#0B0E14] border-r border-[#1F2633] relative overflow-hidden">
        <div 
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage: `radial-gradient(circle, #1e293b 1px, transparent 1px)`,
            backgroundSize: "24px 24px",
          }}
        />
        <div className="relative z-10 flex items-center gap-2">
          <span className="text-xl">⚡</span>
          <span className="text-lg font-semibold tracking-wide">InfraForge</span>
        </div>
        <div className="relative z-10 max-w-md">
          <p className="font-mono text-sm text-[#AAB4C5] leading-relaxed tracking-tight">
            "The canvas is the blueprint. The pipeline is the engine. Chaos is the test. Monitoring is the truth."
          </p>
        </div>
        <div className="relative z-10 text-xs text-[#677185]">
          Simulation theater — educational, never production sizing advice.
        </div>
      </div>
      
      {/* Right Panel */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          {children}
        </div>
      </div>
    </div>
  );
}