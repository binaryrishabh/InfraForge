DRAFT for owner and legal review. Not legal advice.

# InfraForge Privacy Policy

Effective date: [OWNER: P01 - Set the effective date and confirm this policy matches the release being published.]

## Who handles your data

InfraForge is operated by an individual founder in India. The responsible data fiduciary/controller is [OWNER: P02 - Insert the same legal operator name and service address as the Terms.]. Privacy requests and grievances: [OWNER: P03 - Give the authorised grievance contact's name, role, monitored email and postal contact; identify a statutory officer only if applicable.].

This draft covers InfraForge's Learning and Engineering service, subject to the domains and capabilities confirmed in the [Terms](terms-of-service.md). Technical descriptions below are based on this checkout, not inspection of a live database or hosting account.

## Information used to provide the service

| Information | What the reviewed code stores or supports | Purpose |
| --- | --- | --- |
| Account profile | User ID, name, optional username, email, verification flag, optional image and creation/update dates | Identify your account and associate your work with it |
| Sign-in records | Password hash for credential accounts; provider/account identifiers and optional OAuth tokens, token expiry and scope when provider sign-in is configured | Authenticate you and maintain your chosen sign-in method |
| Sessions | Session token, expiry, timestamps and optional IP address and browser user-agent | Keep you signed in and check access |
| Verification records | Identifier, value and expiry fields exist in the schema | Support authentication verification records; this table alone does not establish a working email-verification or reset service |
| Designs and runs | Names, layouts, ownership identifiers, workload/input data, seeds, actions, predictions, learning hypotheses, evidence, results and timestamps; some internal runs include access-grant reasons and submission identifiers | Save work, show history, compare results and verify submissions |

Sources: [account and run models](../../apps/backend/prisma/schema.prisma), [authentication](../AUTHENTICATION.md), [auth setup](../../apps/backend/auth/createAuth.ts) and [submission admission](../../apps/backend/firstStack/admission.ts). Optional database fields describe possible storage, not proof every record contains them. Passwords use salted scrypt; configured OAuth tokens are encrypted by Better Auth. Do not put real cloud secrets or another person's personal information into design names, workload recordings or notes.

## Browser work and server work

Browser simulations execute on your device. The implemented submission path sends design inputs, workload records and browser evidence to the server. In that path, scored/shared submissions are verified on the server; private submissions are stored without the same server verification. Its router is deliberately not mounted in the public API in this checkout. Existing and internal simulation paths also execute on the server; the deployment record identifies Model 1 as active and Model 2 as internal. Saving ordinary designs also sends their layouts to the server. A local draft is not evidence that all simulation data stays on your device. See [browser execution](../../apps/web/src/firstStack/worker/execute.ts), [submission admission](../../apps/backend/firstStack/admission.ts), [verification](../../apps/backend/firstStack/submissionWorker.ts), [submission route status](../../apps/backend/firstStack/submissionRoutes.ts), [internal access](../../apps/backend/firstStack/routes.ts), [design API](../../apps/web/src/api/infrastructure.api.ts) and [deployment](../DEPLOYMENT.md).

Saved designs and run access use account ownership checks. The word "shared" on a submission does not by itself establish a public gallery or permission for anyone to read your account. See [access rules](../AUTHENTICATION.md) and [submission routes](../../apps/backend/firstStack/submissionRoutes.ts).

Your browser also stores drafts, preferences and hint progress. Some drafts survive sign-out. See the [Cookie Notice](cookie-notice.md) for the storage inventory and clearing instructions.

## Sign-in, verification and reset

Username/email/password sign-in is enabled. Google and GitHub are optional and appear only when configured. Provider information depends on the selected provider and its permissions. Automatic account linking is disabled. Email/password registration currently leaves email unverified; email verification is not required. This checkout does not configure verification-email or password-reset delivery, so this notice does not promise working email links. Sources: [authentication](../AUTHENTICATION.md) and [auth settings](../../apps/backend/auth/settings.ts).

[OWNER: P04 - Reconcile the intended new deletion, pseudonymisation, email-verification and password-reset implementation with the release; document exact data affected, delivery provider, expiry and user steps before promising those features.]

## Logs and analytics

Authentication logging is set to operational errors; the application authentication path does not log credential bodies. General unexpected-request handling emits a bounded operational warning. This is not a claim that hosting providers collect no access metadata. See [auth logging](../../apps/backend/auth/createAuth.ts), [credential handling](../AUTHENTICATION.md) and [request errors](../../apps/backend/utils/middleware.ts).

Vercel Analytics is mounted in the web application without a consent gate in that component. Whether collection is active on a deployed site depends on deployment settings. Vercel describes Web Analytics as using no cookies. This is not a blanket claim that all infrastructure logs or analytics data are anonymous. Sources: [application mount](../../apps/web/src/app/App.tsx) and [Vercel documentation](https://vercel.com/docs/analytics/privacy-policy).

[OWNER: P05 - Choose whether to keep Vercel Analytics, remove it or select another provider; confirm actual fields, purpose, retention, legal basis and any required prior opt-in and withdrawal controls across both sites.]

[OWNER: P06 - Inventory application, proxy, host and provider logs; specify collected metadata, access controls and retention/deletion periods. Do not apply backup expiry windows to logs.]

## Service providers and locations

The deployment docs describe Neon PostgreSQL, AWS EC2 backend hosting and Vercel frontend hosting. Backups to AWS S3 require the separate installation described below. These providers handle the data needed for their roles; contracts and actual regions require owner verification. See [deployment](../DEPLOYMENT.md), [bootstrap](../PRODUCTION_BOOTSTRAP.md) and [backup operations](../operations/backup-alerts.md).

| Provider | Role and data relevant to that role | Configuration condition |
| --- | --- | --- |
| Neon | Database storage of account, session, design and run records | Confirm actual project, region and provider recovery-history settings |
| AWS EC2 | Backend processing, including authenticated requests and server verification | Confirm host region, logging and operator access |
| AWS S3 | Database backup copies, which can include personal data | Only if the documented backup installation is enabled |
| Vercel | Frontend delivery and request metadata; Web Analytics if active | Confirm project settings and the analytics decision above |
| AWS SES or Resend | Proposed transactional email delivery, including recipient address and message/link data | Neither is established as configured by the reviewed auth code; choose and verify before enabling |
| Cloudflare Turnstile | Proposed bot check involving browser/network signals and a verification token | No integration found in the reviewed app/auth source; disclose actual handling before configuration |
| Google or GitHub | Optional sign-in provider and authorised profile/account information | Only when that provider is configured and selected; the provider also has its own privacy terms |

[OWNER: P07 - Confirm the active provider list, regions, subprocessors, agreements and international data flows; remove unselected options from the published notice.]

Data may be processed outside your country according to those choices. [OWNER: P08 - Specify actual destinations and applicable transfer safeguards, including EU transfer mechanisms and how to obtain a copy; check Indian transfer restrictions. Do not assert adequacy, SCCs or India-only storage without evidence.]

## Retention and deletion

Sessions have fixed seven-day expiry and no silent renewal. Expiry ends validity; it is not evidence of automatic removal of every expired database row. See [authentication access rules](../AUTHENTICATION.md).

Deleting an inactive design leaves historical runs, which keep their own ownership records. User links on designs and runs include restrictive deletion relationships. The reviewed authentication configuration does not enable account deletion or define a pseudonymised retention workflow. We cannot promise that pressing sign-out, deleting a design or requesting closure automatically erases all records. Sources: [schema](../../apps/backend/prisma/schema.prisma), [auth configuration](../../apps/backend/auth/createAuth.ts) and [authentication access rules](../AUTHENTICATION.md).

Ask the privacy contact for access, correction or erasure. [OWNER: P09 - Establish and publish a workable request process, identity checks, response deadlines and account-closure route; use a documented manual review until a verified self-service workflow exists.]

[OWNER: P10 - Set purpose-based retention periods for account data, verification records, designs, runs and evidence; define any necessary legal/security retention and the exact pseudonymisation procedure. Pseudonymised data remains personal data when it can still be linked to a person.]

If installed, the backup runbook schedules daily copies and a weekly copy. S3 daily objects expire after 7 days and weekly objects after 28 days; lifecycle deletion is asynchronous. Older object versions expire one day after becoming noncurrent. The latest local successful copy stays until a replacement upload succeeds, so it has no guaranteed 28-day maximum. Neon's recovery history is a separate provider setting. These are documented settings, not proof that backups are installed or that all copies have already been erased. Source: [backup retention](../operations/backup-alerts.md).

[OWNER: P11 - Confirm backup installation, Neon recovery retention, local-copy limits and deletion handling after restore; establish how erasure requests and legal holds affect all copies without promising instant backup erasure.]

## Choices, consent and privacy rights

For India, the proposed process should explain each purpose before consent, allow withdrawal as easily as consent, and stop consent-based use when required. Applicable DPDP rights include access information, correction/completion, erasure, grievance redress and nomination. Use the grievance contact first; escalation to the Data Protection Board follows applicable law. These descriptions are subject to commencement and lawful retention exceptions. Sources: [DPDP Act, sections 5-6, 8 and 11-14](https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf) and [Rules](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf).

For EU visitors where GDPR applies, request access, correction, erasure, restriction or qualifying portability; object to legitimate-interest processing and withdraw consent without affecting earlier lawful processing. Complain to your competent supervisory authority. Contract may support account/run services, legitimate interests security, consent optional analytics, and legal obligations required retention, but each basis must be assessed. Sources: [GDPR Articles 6, 12-22 and 77](https://eur-lex.europa.eu/eli/reg/2016/679/).

[OWNER: P12 - Confirm purposes and lawful bases, consent wording and records, withdrawal route, rights-response procedure and any EU representative requirement. Terms acceptance is not blanket privacy consent.]

Withdrawing necessary processing may mean account features can no longer be supplied. Optional analytics choices should not be a condition of core service access. The contact/process placeholders must be resolved before users are directed to them.

Automated simulation scoring evaluates a submitted design. It does not establish an employment, credit or other legally significant decision about you. [OWNER: P13 - Confirm actual score/certificate uses, any consequential automated decisions and an appropriate human review route.]

## Children, security and changes

[OWNER: P14 - Approve the age policy and handling of child data; recommended initial scope is adults only. Do not claim age verification or parental-consent controls exist without testing them.]

The reviewed configuration uses password hashing, HttpOnly session cookies, origin and ownership checks, and HTTPS requirements in production. These measures do not guarantee absolute security. See [authentication](../AUTHENTICATION.md). [OWNER: P15 - Confirm operational access controls and the incident response and legally required breach-notification procedure.]

[OWNER: P16 - Choose policy-change notification and version-history arrangements; obtain fresh consent when a changed purpose legally requires it.]
