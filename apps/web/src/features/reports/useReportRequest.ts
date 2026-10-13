import { useEffect, useState } from "react";

export function useReportRequest<T>(load: () => Promise<T>) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ request: typeof load | null; data: T | null; error: string | null; loading: boolean }>({ request: null, data: null, error: null, loading: true });
  useEffect(() => {
    let active = true;
    void load().then((data) => { if (active) setState({ request: load, data, error: null, loading: false }); })
      .catch(() => { if (active) setState({ request: load, data: null, error: "The recorded run data could not be loaded. It may be unavailable or your session may have ended.", loading: false }); });
    return () => { active = false; };
  }, [load, attempt]);
  const retry = () => { setState({ request: load, data: null, error: null, loading: true }); setAttempt((value) => value + 1); };
  return { ...(state.request === load ? state : { data: null, error: null, loading: true }), retry };
}
