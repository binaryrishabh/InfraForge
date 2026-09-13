import { DeploymentStatus } from "@shared/enum/DeploymentStatus.enum";

interface LiveWaitingStateProps {
  status: string;
  isConnectionError: boolean;
}

/* Floating waiting card for the not-yet-LIVE states of a deployment
(provisioning, failed, connection lost). One centered card in modal grammar
over the canvas — the bare mono text spans are retired. */
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
    ? "text-[#F5A524]"
    : isFailed
      ? "text-[#F0564A]"
      : "text-[#EDF1F7]";

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
      <div className="pointer-events-auto bg-[#171C27] border border-[#273042] rounded-[14px] px-6 py-5 shadow-[0_24px_60px_rgba(0,0,0,0.55)] text-center max-w-sm">
        {!isConnectionError && !isFailed && (
          <span className="block w-4 h-4 border-2 border-[#677185]/30 border-t-[#AAB4C5] rounded-full animate-spin mx-auto mb-2" />
        )}
        <p className={`text-[14px] font-semibold ${titleTone}`}>{title}</p>
        <p className="text-[12px] text-[#AAB4C5] mt-1">{subline}</p>
      </div>
    </div>
  );
}