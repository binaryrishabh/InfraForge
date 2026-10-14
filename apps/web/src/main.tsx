import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./app/App.tsx";
import { applyPreferences, usePreferences } from "./app/preferences";

// Apply theme and density before the first render, then follow changes and the system theme.
const apply = () => { const { theme, density } = usePreferences.getState(); applyPreferences(theme, density); };
apply();
usePreferences.subscribe(apply);
window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", apply);

createRoot(document.getElementById("root")!).render(<App />);
