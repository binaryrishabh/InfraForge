import { useEffect, useState } from "react";

const DEFAULT_ERROR = "This information could not be loaded. It may be unavailable, or your session may have ended.";

/* Loads once per `load` identity (memoise it with useCallback). A newer request
always replaces an older one; retry repeats the same request. */
export function useRequest<T>(load: () => Promise<T>, errorText = DEFAULT_ERROR) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ request: typeof load | null; data: T | null; error: string | null; loading: boolean }>({ request: null, data: null, error: null, loading: true });
  useEffect(() => {
    let active = true;
    void load().then((data) => { if (active) setState({ request: load, data, error: null, loading: false }); })
      .catch(() => { if (active) setState({ request: load, data: null, error: errorText, loading: false }); });
    return () => { active = false; };
  }, [load, attempt, errorText]);
  const retry = () => { setState({ request: load, data: null, error: null, loading: true }); setAttempt((value) => value + 1); };
  return { ...(state.request === load ? state : { data: null, error: null, loading: true }), retry };
}
