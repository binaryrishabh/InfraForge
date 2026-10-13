import { Link, useLocation, useNavigate } from "react-router-dom";
import { useCanvasStore } from "../store/canvasStore";
import { readImprovementContext } from "../improvement";

export function ImprovementBanner() {
  const location = useLocation(), navigate = useNavigate();
  const id = useCanvasStore((s) => s.currentLayoutId);
  const context = readImprovementContext(location.state, id);
  if (!context) return null;
  return <div className="absolute top-18 left-4 z-30 max-w-[calc(100vw-2rem)] rounded-lg bg-[#1C1F26] border border-[#2A2E37] p-3 text-xs space-y-2">
    <p>Improving the saved design. Deploy will preview this canvas against the <Link className="text-[#4FA89B] underline" to={`/reports/${context.sourceRunId}`}>source run</Link>.</p>
    <button className="text-[#4FA89B] underline" onClick={() => navigate("/design", { replace: true, state: null })}>Clear source context / deploy normally</button>
  </div>;
}
