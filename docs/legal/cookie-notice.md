DRAFT for owner and legal review. Not legal advice.

# InfraForge Cookie Notice

Effective date: [OWNER: C01 - Set the effective date and validate this inventory on the release domains.]

Cookies are small values a browser sends back to a site. Local storage and session storage keep values in your browser too, but do not automatically send them as cookies. This draft describes the reviewed application and flags deployment-dependent items. The operator and privacy contact are identified in the [Privacy Policy](privacy-policy.md).

## Sign-in cookies

InfraForge uses Better Auth database sessions. Its session-token cookie is needed for authenticated features. Cookies are host-only, HttpOnly, SameSite=Lax and scoped to `/`; HTTPS enables Secure cookies. The configured session has a fixed seven-day expiry without silent renewal; sign-out revokes the session. Browser cookie expiry and database-row deletion are separate. Cookie session caching is disabled. Sources: [auth configuration](../../apps/backend/auth/createAuth.ts), [settings](../../apps/backend/auth/settings.ts) and [authentication](../AUTHENTICATION.md).

The pinned Better Auth 1.7.7 defaults name the token cookie `better-auth.session_token`, with `__Secure-` on HTTPS. The library also supports a `better-auth.dont_remember` marker for a nonpersistent sign-in; issuance depends on the request. OAuth, when configured, can need temporary state protection cookies. These conditional cookies must not be described as cookies set on every visit. See [pinned cookie implementation](https://github.com/better-auth/better-auth/blob/v1.7.7/packages/better-auth/src/cookies/index.ts) and [OAuth state implementation](https://github.com/better-auth/better-auth/blob/v1.7.7/packages/better-auth/src/state.ts).

[OWNER: C02 - Capture actual Set-Cookie names, host, purpose, flags and lifetimes for credential sign-in/out and each enabled OAuth flow; confirm conditional dont_remember/state cookies and exclude disabled session-cache cookies. This source inventory is not a live-cookie audit.]

## Other storage in the application

| Storage and key | Purpose | Persistence and source |
| --- | --- | --- |
| Local storage: `infraforge:draft:<userId>` | Unsaved canvas resources, connections, design and challenge references | No automatic expiry; named drafts remain after sign-out. [Draft key](../../apps/web/src/features/auth/drafts.ts), [persistence](../../apps/web/src/features/canvas/hooks/useCanvasPersistence.ts), [auth docs](../AUTHENTICATION.md) |
| Local storage: `infraforge:preferences` | Theme and density | No automatic expiry. [Preferences](../../apps/web/src/app/preferences.ts) |
| Local storage: `infraforge:palette-rail` | Palette display preference | No automatic expiry. [Workspace](../../apps/web/src/features/canvas/components/designer/DesignWorkspace.tsx) |
| Local storage: `infraforge:hints:<challengeId>:v<version>` | Number of hints revealed in this browser | No automatic expiry; key is not account-specific. [Hints](../../apps/web/src/features/challenges/components/HintReveal.tsx) |
| Session storage: `infraforge-model2-authoring/1:<owner>` | Internal authoring draft, review and last-run reference | Browser page-session lifetime; internal-feature access applies. [Authoring draft](../../apps/web/src/features/internalModel2/draft.ts) |
| Session storage: `infraforge-object-restart/1:<owner>` | Internal lesson draft and review | Browser page-session lifetime; internal-feature access applies. [Lesson draft](../../apps/web/src/features/internalLessons/lessonDraft.ts) |

People using the same browser profile can inspect local storage. Avoid saving secrets in a draft. Browser session restoration can preserve session-storage data; clearing site data is the reliable way to remove local copies you no longer want.

## Analytics, providers and bot checks

The web app mounts Vercel Analytics; its component does not wait for a consent choice. Vercel describes Web Analytics as cookie-free. Collection on a hosted deployment depends on its settings. Source: [app component](../../apps/web/src/app/App.tsx) and [Vercel privacy documentation](https://vercel.com/docs/analytics/privacy-policy). Cookie-free does not mean no disclosure or lawful-basis assessment is needed. The analytics decision is recorded in the Privacy Policy.

No Turnstile integration or SES/Resend email delivery is established by the reviewed application/auth source. If Cloudflare Turnstile is configured later, disclose the verified browser/network data and any storage it uses. Hosting or provider sign-in pages can have their own cookies; their presence and lifetimes require a deployment audit.

[OWNER: C03 - Verify cookies/storage on both sites, hosting protection and enabled provider/bot-check flows; list any additions with purpose and duration, or remove unselected services from publication.]

## Your choices

Use your browser's site-data settings to inspect or delete cookies, local storage and session storage for each frontend/API domain. Blocking sign-in cookies prevents authenticated features. Clearing drafts loses local unsaved work; clearing browser storage does not erase saved server records. Sign out before leaving a shared device and clear its site data if needed.

[OWNER: C04 - Decide which storage needs prior consent in the served jurisdictions and provide working optional-storage controls, including rejection and withdrawal; do not claim a consent banner or analytics opt-out already exists.]

For access, deletion or privacy complaints, use the contact and process in the [Privacy Policy](privacy-policy.md).
