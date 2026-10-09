# InfraForge frontend

React 19, Vite, Tailwind, Zustand and dnd-kit implement the architecture canvas,
deployment controls and simulation monitoring. Install dependencies once from the
repository root with `bun install --frozen-lockfile`.

From this directory, `bun run dev` serves `http://localhost:5173/`; `bun run build`,
`bun run lint`, `bun run typecheck` and `bun run test` check the frontend. Root
commands also check its domain/catalog dependencies and package boundaries.

API and WebSocket addresses use `VITE_BACKEND_API_URL` and `VITE_WS_URL`, with local
defaults. [Authentication](../docs/AUTHENTICATION.md) uses backend sessions and
configured Google/GitHub sign-in. Drafts use server-user-specific localStorage keys.
Explicit save/update and the pre-run deploy path persist
layouts through the API; live edits affect the running simulation without saving.
Monitoring displays backend snapshots; it must not generate simulation results.

See [project setup](../Readme.md) and [accepted architecture and risks](../docs/PROJECT_STATE.md).
