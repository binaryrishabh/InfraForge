DRAFT for owner and legal review. Not legal advice.

# InfraForge Cookie Notice

Effective date: [OWNER: set at publication]

Cookies are small values a browser sends back to a site. Local storage and session storage keep values in your browser too, but do not automatically send them as cookies. This draft describes the reviewed application and flags deployment-dependent items. The operator and privacy contact are identified in the [Privacy Policy](privacy-policy.md).

## Sign-in cookies

InfraForge uses Better Auth database sessions. Its session-token cookie is needed for authenticated features. Cookies are host-only, HttpOnly, SameSite=Lax and scoped to `/`; HTTPS enables Secure cookies. The configured session has a fixed seven-day expiry without silent renewal; sign-out revokes the session. Browser cookie expiry and database-row deletion are separate. Cookie session caching is disabled. Sources: [auth configuration](../../apps/backend/auth/createAuth.ts), [settings](../../apps/backend/auth/settings.ts) and [authentication](../AUTHENTICATION.md).

| Cookie (HTTPS name) | Purpose and duration |
| --- | --- |
| `__Secure-better-auth.session_token` | Signed session token; normally seven days (604,800 seconds); session-only when nonpersistent sign-in is requested |
| `__Secure-better-auth.dont_remember` | Conditional nonpersistent-sign-in marker; browser session, no Max-Age |
| `__Secure-better-auth.state` | Conditional Google/GitHub OAuth state protection using the configured database strategy; five minutes, cleared on callback |

All use the flags and API-host scope above. Local HTTP uses the same names without `__Secure-` and without Secure. Cookie caching and account-cookie storage are disabled, so `better-auth.session_data` and `better-auth.account_data` are not active storage. The alternative ten-minute `better-auth.oauth_state` cookie belongs to the unselected cookie-state strategy. These are source-derived defaults, not a live-domain audit. Sources: [pinned cookies](https://github.com/better-auth/better-auth/blob/v1.7.7/packages/better-auth/src/cookies/index.ts), [OAuth state](https://github.com/better-auth/better-auth/blob/v1.7.7/packages/better-auth/src/state.ts) and [database-strategy default](https://github.com/better-auth/better-auth/blob/v1.7.7/packages/better-auth/src/context/create-context.ts).

## Other storage in the application

| Storage and key | Purpose | Persistence and source |
| --- | --- | --- |
| Local storage: `infraforge:draft:<userId>` | Unsaved canvas resources, connections, design and challenge references | No automatic expiry; named drafts remain after sign-out. [Draft key](../../apps/web/src/features/auth/drafts.ts), [persistence](../../apps/web/src/features/canvas/hooks/useCanvasPersistence.ts), [auth docs](../AUTHENTICATION.md) |
| Local storage: `infraforge:preferences` | Theme and density | No automatic expiry. [Preferences](../../apps/web/src/app/preferences.ts) |
| Local storage: `infraforge:palette-rail` | Palette display preference | No automatic expiry. [Workspace](../../apps/web/src/features/canvas/components/designer/DesignWorkspace.tsx) |
| Local storage: `infraforge:hints:<challengeId>:v<version>` | Number of hints revealed in this browser | No automatic expiry; key is not account-specific. [Hints](../../apps/web/src/features/challenges/components/HintReveal.tsx) |
| Local storage: `if-mode` | Marketing page light/dark appearance | No automatic expiry. [Marketing theme](../../apps/web/marketing/sections/site.mjs) |
| Session storage: `infraforge-model2-authoring/1:<owner>` | Internal authoring draft, review and last-run reference | Browser page-session lifetime; internal-feature access applies. [Authoring draft](../../apps/web/src/features/internalModel2/draft.ts) |
| Session storage: `infraforge-object-restart/1:<owner>` | Internal lesson draft and review | Browser page-session lifetime; internal-feature access applies. [Lesson draft](../../apps/web/src/features/internalLessons/lessonDraft.ts) |

Legacy local-storage keys `infraforge_auth_registry`, `infraforge_auth_session` and `Infraforge_Infrastucture_Draft` are removed by [migration cleanup](../../apps/web/src/features/auth/drafts.ts); they are not new account storage.

People using the same browser profile can inspect local storage. Avoid saving secrets in a draft. Browser session restoration can preserve session-storage data; clearing site data is the reliable way to remove local copies you no longer want.

## Analytics, providers and bot checks

We keep Vercel Web Analytics for cookieless aggregate page analytics. The [app component](../../apps/web/src/app/App.tsx) mounts it without a consent gate; hosted collection depends on Vercel project settings. It helps us understand page usage and improve the service. See [Vercel's privacy disclosure](https://vercel.com/docs/analytics/privacy-policy) and the [Privacy Policy](privacy-policy.md#logs-and-analytics).

Cloudflare Turnstile applies only if enabled with its site key, secret and allowed hostnames. Its backend adapter validates signup tokens, and reset tokens when password reset is enabled, forwarding a client IP when supplied. The current frontend has no widget integration; the code does not establish an active Turnstile browser cookie or storage key. See [challenge configuration](../../apps/backend/auth/turnstile.ts) and [UI status](../AUTHENTICATION.md#export-and-ui-follow-up). SES or Resend, if enabled for email delivery, does not add a browser-storage key in this application. Optional Google/GitHub sign-in redirects to provider pages governed by their own notices; the table above covers InfraForge's state cookie.

## Your choices

Use your browser's site-data settings to inspect or delete cookies, local storage and session storage for each frontend/API domain. Blocking sign-in cookies prevents authenticated features. Clearing drafts loses local unsaved work; clearing browser storage does not erase saved server records. Sign out before leaving a shared device and clear its site data if needed.

Only essential cookies are otherwise used, so no consent banner is required for those essential cookies. To opt out of analytics, use browser privacy settings or tracking protection to block analytics requests, and enable Do Not Track where honoured. There is no dedicated analytics opt-out control or DNT check in the current app. Browser controls may also disable useful service features.

For access, deletion or privacy complaints, use the contact and process in the [Privacy Policy](privacy-policy.md).

Material changes to this notice will be announced at least 14 days in advance by email and a site banner.

## Version history

- 2026-10-23: Draft inventory checked against current source; launch analytics and storage choices recorded; not yet effective.
