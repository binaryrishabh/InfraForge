/* Four staggered smoke wisps above a FAILED card. */
export function SmokeWisps() {
  return (
    <div className="absolute -top-1 left-1/2 -translate-x-1/2 pointer-events-none z-10">
      <div className="infraforge-smoke-wisp" style={{ animationDelay: "0s", left: "-6px" }} />
      <div className="infraforge-smoke-wisp" style={{ animationDelay: "0.6s", left: "0px" }} />
      <div className="infraforge-smoke-wisp" style={{ animationDelay: "1.2s", left: "6px" }} />
      <div className="infraforge-smoke-wisp" style={{ animationDelay: "1.8s", left: "3px" }} />
    </div>
  );
}