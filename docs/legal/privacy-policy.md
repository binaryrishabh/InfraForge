DRAFT for owner and legal review. Not legal advice.

# InfraForge Privacy Policy

Effective date: [OWNER: set at publication]

## Who handles your data

InfraForge is operated by an individual founder in India. The responsible operator is [OWNER: P02 - Insert the same legal name and trading name as the Terms.]. The service address and support/legal email are listed in the [Terms](terms-of-service.md#who-provides-the-service). Privacy requests and grievances: [OWNER: P03 - Give the grievance officer's name and contact details.].

This policy covers InfraForge Learning and Engineering. Technical descriptions reflect this checkout; deployment-dependent services are identified below.

## Information used to provide the service

| Information | What the reviewed code stores or supports | Purpose |
| --- | --- | --- |
| Account profile | User ID, name, optional username, email, verification flag, optional image and creation/update dates | Identify your account and associate your work with it |
| Sign-in records | Password hash for credential accounts; provider/account identifiers and optional OAuth tokens, token expiry and scope when provider sign-in is configured | Authenticate you and maintain your chosen sign-in method |
| Sessions | Session token, expiry, timestamps and optional IP address and browser user-agent | Keep you signed in and check access |
| Verification records | Reset records and a hash-only verification-token ledger with expiry and redemption status | Verify email and support password recovery when enabled |
| Designs and runs | Names, layouts, ownership identifiers, workload/input data, seeds, actions, predictions, learning hypotheses, evidence, results and timestamps; some internal runs include access-grant reasons and submission identifiers | Save work, show history, compare results and verify submissions |

Sources: [account and run models](../../apps/backend/prisma/schema.prisma), [authentication](../AUTHENTICATION.md), [auth setup](../../apps/backend/auth/createAuth.ts) and [submission admission](../../apps/backend/firstStack/admission.ts). Optional database fields describe possible storage, not proof every record contains them. Passwords use salted scrypt; configured OAuth tokens are encrypted by Better Auth. Do not put real cloud secrets or another person's personal information into design names, workload recordings or notes.

## Browser work and server work

Browser simulations execute on your device. The implemented submission path sends design inputs, workload records and browser evidence to the server. In that path, scored/shared submissions are verified on the server; private submissions are stored without the same server verification. Its router is deliberately not mounted in the public API in this checkout. Existing and internal simulation paths also execute on the server; the deployment record identifies Model 1 as active and Model 2 as internal. Saving ordinary designs also sends their layouts to the server. A local draft is not evidence that all simulation data stays on your device. See [browser execution](../../apps/web/src/firstStack/worker/execute.ts), [submission admission](../../apps/backend/firstStack/admission.ts), [verification](../../apps/backend/firstStack/submissionWorker.ts), [submission route status](../../apps/backend/firstStack/submissionRoutes.ts), [internal access](../../apps/backend/firstStack/routes.ts), [design API](../../apps/web/src/api/infrastructure.api.ts) and [deployment](../DEPLOYMENT.md).

Saved designs and run access use account ownership checks. The word "shared" on a submission does not by itself establish a public gallery or permission for anyone to read your account. See [access rules](../AUTHENTICATION.md) and [submission routes](../../apps/backend/firstStack/submissionRoutes.ts).

Your browser also stores drafts, preferences and hint progress. Some drafts survive sign-out. See the [Cookie Notice](cookie-notice.md) for the storage inventory and clearing instructions.

## Sign-in, verification and reset

Username/email/password sign-in is enabled. Google and GitHub are optional and appear only when configured. Automatic account linking is disabled. Account essentials default to disabled; configuring an email provider alone does not enable them. When enabled with real SES or Resend delivery, credential signup requires email verification before sign-in. Verification does not automatically sign you in. Verification and reset links expire after 30 minutes and are single-use. Resetting a password revokes all sessions. Expired or already used links require a new email request. Delivery is bounded and asynchronous, so failed or dropped mail may require resending.

These APIs and typed clients are implemented; verification, recovery, deletion, export and Turnstile user interfaces remain pending. We do not promise that in-app controls are already available. Sources: [authentication](../AUTHENTICATION.md), [configuration](../../apps/backend/auth/createAuth.ts), [token ledger](../../apps/backend/auth/verification.ts) and [deployment defaults](../DEPLOYMENT.md#owner-checklist-optional-account-essentials).

## Logs and analytics

The app records operational failures and worker lifecycle/status events, including deployment identifiers and validation-failure reasons. Authentication and email-delivery failures use fixed messages; unexpected HTTP failures use a bounded warning without request bodies or internal error details. The managed Nginx template disables access logging and discards error logs for both HTTP and HTTPS backend virtual hosts to avoid recording bearer links. Docker captures container stdout/stderr with its local logging driver, rotating at 10 MB per file and three files per container. These size limits do not implement a time limit. Host service journals and provider request metadata are separate operational records.

Our operational log retention target is 30 days, with access restricted to authorised operators. Time-based cleanup and provider settings must support that target; this documentation change does not install them. Passwords, secrets, auth-link tokens and export bodies must not enter logs. Sources: [auth logger](../../apps/backend/auth/createAuth.ts), [email](../../apps/backend/auth/email.ts), [request errors](../../apps/backend/utils/middleware.ts), [worker](../../apps/backend/worker.ts), [Nginx](../../ops/nginx.conf.template) and [Docker logging](../../apps/backend/docker-compose.yml).

We keep Vercel Web Analytics for cookieless aggregate page analytics to understand usage and improve the service. It is mounted in the [web app](../../apps/web/src/app/App.tsx); collection depends on Vercel project settings. Aggregate statistics include page visits, referrers, broad location, browser and device information. Vercel describes a visitor hash discarded after 24 hours; that is not a promise that all aggregate statistics expire after 24 hours. See [Vercel's disclosure](https://vercel.com/docs/analytics/privacy-policy).

Use browser privacy settings or tracking protection to block analytics requests; enable Do Not Track where honoured. The current app has no dedicated analytics opt-out control and does not implement a DNT check. Only essential cookies are otherwise used, so no consent banner is required for those essential cookies. See the [Cookie Notice](cookie-notice.md).

## Service providers and locations

| Provider | Role and relevant data | Status or condition |
| --- | --- | --- |
| Neon (PostgreSQL) | Account, session, design and run database | Database provider; project region and recovery-history window are not established by source |
| AWS EC2, us-east-1 (United States) | Backend processing, authenticated requests and server execution | Hosting region supplied by the task brief; not a live-account audit |
| AWS S3, planned in us-east-1 | Encrypted database backup copies containing database personal data | Planned; not yet installed in the new AWS account |
| Vercel | Frontend delivery/request metadata and cookieless aggregate Web Analytics | Frontend and retained analytics provider; collection depends on project settings |
| AWS SES | Recipient address and verification/reset message/link data | Only if selected and enabled with account essentials; region follows SES configuration |
| Resend | Recipient address and verification/reset message/link data | Only if selected and enabled with account essentials |
| Cloudflare Turnstile | Bot-check browser/network signals; server validation sends the token and, when supplied, client IP | Only if enabled by site key, secret and exact hostname settings; frontend widget is pending |
| Google or GitHub | Authorised profile/account information for sign-in | Only if configured and selected by you; provider privacy terms also apply |

Turnstile protects credential signup when configured, independently of the account-essentials flag, and password reset when that API is enabled. No configured Turnstile provider is inferred from the presence of its adapter.

Data is processed in the United States for the specified AWS hosting and may be processed internationally through Neon, Vercel and any enabled providers. We do not claim India-only storage, a particular Neon region, an adequacy decision or signed transfer safeguards without evidence. Contact the privacy/grievance email for information about applicable destinations and safeguards. Sources and configuration limits are recorded in the [review register](README.md).

## Retention and deletion

| Data | Retention policy and implementation limits |
| --- | --- |
| Account profile and sign-in records | Until account deletion; the deletion transaction removes credentials, OAuth tokens and sessions and replaces the profile as described below |
| Sessions | Fixed seven-day validity with no silent renewal; expiry is separate from database-row cleanup |
| Reset and email-verification tokens | Expire after 30 minutes; the policy is to purge expired records. No scheduled expiry purge is implemented in the reviewed application; deletion removes user-linked reset/verification records and the verification ledger |
| Designs, runs and evidence | Kept until account deletion; deletion scrubs saved designs but retains immutable historical run records under a disabled opaque owner ID |
| Operational logs | 30-day retention target; Docker size rotation alone does not enforce this period |
| Backups | Planned rolling 28-day backup policy once installed, with the recovery and deletion limits below |

When enabled, deletion requires a signed-in session, your current password and typing `DELETE`. Finish or stop active runs first: pending, running, live or unresolved reserved work blocks deletion. OAuth-only users can first establish a password through mailbox recovery. Export before deletion, which revokes subsequent access.

Deletion removes sessions, credentials/OAuth tokens, user-linked reset/verification records, verification redemption records and internal access grants. It replaces your profile with a disabled account and a random unreachable `@deleted.invalid` address; clears username, image and verification status; and scrubs saved design names, layouts and legacy user identifiers. Opaque design and owner IDs remain for historical references.

Run IDs, owner IDs, captured run names, immutable inputs, lineage, actions, samples, cuts and results remain unchanged. This is profile erasure and pseudonymisation, not complete erasure of arbitrary personal text in historical runs. Pseudonymised data may still be personal data. Re-registering with the same email or username cannot recover or adopt that history. Sign-out does not erase browser drafts; clear site data on shared devices. Sources: [deletion semantics](../AUTHENTICATION.md#deletion-and-retained-history), [transaction](../../apps/backend/auth/accountData.ts) and [account routes](../../apps/backend/auth/accountRoutes.ts).

Backups are designed but not yet installed in the new AWS account. The plan is a daily `pg_dump` archive, encrypted at rest on encrypted host storage and in private S3 storage, targeting 28 daily copies and four weekly copies. Daily and weekly S3 objects expire after 28 days; noncurrent versions expire after one day. Lifecycle deletion is asynchronous. The latest successful local copy remains until a replacement upload succeeds, so the current design does not guarantee a 28-day limit for that local copy. Neon point-in-time recovery (PITR)/restore history is a separate provider capability; its actual window must be checked in the project, not inferred from this backup plan. These are planned controls, not active independent backups. Deletion cannot instantly erase older backup copies; a restore must reapply account deletions before resumed service. Source: [backup design](../operations/backup-alerts.md).

## Requests, choices and human review

Send access, correction, export, deletion, consent-withdrawal or grievance requests to the support/grievance email above. We will check identity before disclosing or changing account data, using proportionate checks tied to the account. Our response target is 30 days. In-app deletion and export will be available once enabled and their UI is ready; until then use email. The export API provides paginated records for your designs, runs, actions, samples, internal runs, lessons, cuts and results, excluding authentication secrets and other users' records.

Where applicable, you may request access, correction, erasure, restriction or portability, object to processing, withdraw consent and complain to the relevant privacy authority. The India request process also covers completion of account information, grievance redress and nomination where those rights apply; contact the grievance officer first. These statements do not claim that every provision of the DPDP framework is already in force. We use account and design data to provide the requested service, operational data to protect it and aggregate analytics to improve it. We handle purpose-specific consent and withdrawal where required; accepting terms is not blanket privacy consent. Withdrawal of processing necessary to provide an account may prevent continued account features. Legal review before publication must confirm jurisdiction-specific duties and any required transfer or representation arrangements.

Scores are practice feedback about submitted designs, not employment, credit or other consequential decisions about a person. No certificates are offered at launch. Request human review through the support email in the Terms.

## Age, security and changes

InfraForge is for adults aged 18 or over only. We do not offer a child-consent service or claim that age verification is implemented. Contact the grievance email if you believe a child has supplied account data.

Access controls include password hashing, HttpOnly cookies, exact-origin and ownership checks, production HTTPS, SSH key-only release access with a pinned host fingerprint, protected Production approval, and operator-owned secrets in a mode-0600 file. Secrets must not be printed in logs. The release workflow uses key authentication; host-wide password-authentication settings are not established by source. These controls do not guarantee absolute security. Operators handle incidents and required notifications under applicable law. See [authentication](../AUTHENTICATION.md), [release workflow](../../.github/workflows/deploy.yml), [deployment approvals](../DEPLOYMENT.md) and [private configuration](../PRODUCTION_BOOTSTRAP.md).

We will give at least 14 days' notice of material policy changes by email and a site banner before they take effect. We will obtain fresh consent where a changed purpose requires it.

## Version history

- 2026-10-23: Draft revised from current source and acting-owner launch decisions; not yet effective.
