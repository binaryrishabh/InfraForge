import { DeploymentStatus } from "@infraforge/contracts/deployment";

interface LiveWaitingStateProps {
  status: string;
  isConnectionError: boolean;
}

/* Floating waiting card for the not-yet-LIVE states of a deployment
(provisioning, failed, connection lost). One centered card in modal grammar
over the canvas — solid surface, semantic tones only. */
export function LiveWaitingState({
  status,
  isConnectionError,
}: LiveWaitingStateProps) {
  const isFailed = status === DeploymentStatus.FAILED;
  const title = isConnectionError
    ? "Connection lost"
    : isFailed
      ? "Deployment failed"
      : "Provisioning environment…";
  const subline = isConnectionError
    ? "reconnecting to the simulation…"
    : isFailed
      ? "the deployment popup carries the failure timeline"
      : "the pipeline gates are running";
  const titleTone = isConnectionError
    ? "text-[#C98A4B]"
    : isFailed
      ? "text-[#C4574A]"
      : "text-[#EDEEF0]";

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
      <div className="pointer-events-auto bg-[#1C1F26] border border-[#2A2E37] rounded-[14px] px-6 py-5 shadow-[0_24px_60px_rgba(0,0,0,0.55)] text-center max-w-sm">
        {!isConnectionError && !isFailed && (
          <span className="block w-4 h-4 border-2 border-[#5A5F6B]/30 border-t-[#8B909C] rounded-full animate-spin mx-auto mb-2" />
        )}
        <p className={`text-[14px] font-semibold ${titleTone}`}>{title}</p>
        <p className="text-[12px] text-[#8B909C] mt-1">{subline}</p>
      </div>
    </div>
  );
}