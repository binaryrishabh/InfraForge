DRAFT for owner and legal review. Not legal advice.

# Legal draft review register

These documents are drafts for owner and legal review, not published legal notices or a claim of compliance. They describe the reviewed source at `fd8253b`; proposed contractual rules are for owner approval. No application, identity, consent, retention or hosting configuration is changed by these documents.

Read [Terms of Service](terms-of-service.md), [Privacy Policy](privacy-policy.md) and [Cookie Notice](cookie-notice.md) together. Resolve the complete placeholder register below and review the matching release before publication. Preserve the distinction between implemented, internally gated, deployment-dependent and merely proposed behavior.

## Brief/source discrepancies and recommended defaults

- **Account deletion and pseudonymised retention:** the brief anticipates new semantics, but [auth configuration](../../apps/backend/auth/createAuth.ts) has no enabled deletion workflow, [authentication docs](../AUTHENTICATION.md) do not define one, and [schema](../../apps/backend/prisma/schema.prisma) keeps restrictive user links on run/design models. No verified account deletion or pseudonymisation promise is possible from this checkout. Default: retain the explicit gap, provide a reviewed manual rights-request process and reconcile the intended release before publication. Do not call a retained pseudonymous run anonymous, and do not confuse design deletion with erasure.
- **Email verification and reset:** [authentication docs](../AUTHENTICATION.md) say email verification is not required and reset awaits real delivery; [createAuth](../../apps/backend/auth/createAuth.ts) contains no delivery callbacks. Default: disclose that limitation, select neither SES nor Resend as active and verify the eventual flow before revising the notice.
- **Browser/server boundary:** the browser runner and scored/shared verifier exist, but [submissionRoutes](../../apps/backend/firstStack/submissionRoutes.ts) expressly leaves public admission unmounted. [Deployment](../DEPLOYMENT.md) records Model 1 active and Model 2 internal. Default: explain both source paths and their gate; do not advertise general availability or claim all simulations run solely in the browser.
- **Analytics:** [App](../../apps/web/src/app/App.tsx) mounts Vercel Analytics with no consent gate there. Default: disclose the mount; recommend disabling collection until its purpose, actual deployment, lawful basis and controls are approved. This documents a recommendation, not an implemented change.
- **Backups:** [backup-alerts](../operations/backup-alerts.md) is an installation procedure, not installed-system evidence. Default: describe the 7/28-day S3 settings conditionally; verify activation, local latest-copy handling and Neon history separately.

## Configuration-dependent claim register

| Choice or operational condition | Claims affected and evidence | Publication decision |
| --- | --- | --- |
| Legal operator, site domains, eligible audience and release date | Scope, responsible party and enforceability across all three notices; Terms T01-T06, Privacy P01-P03/P14, Cookie C01 | Confirm consistent identity, domains, adult/child handling and working contacts |
| Enabled Google/GitHub providers | Provider profile/token handling and temporary sign-in cookies; [settings](../../apps/backend/auth/settings.ts), [createAuth](../../apps/backend/auth/createAuth.ts) | Show only configured options; audit real callbacks and storage |
| Real verification/reset delivery, SES or Resend | Email addresses, message/link data, token lifetime and recovery promises; [auth docs](../AUTHENTICATION.md) | Currently unestablished; choose and test one provider before disclosure as active |
| Account closure, deletion and retained run linkage | Erasure process, restrictions, pseudonymisation, retained data and backup restoration; [schema](../../apps/backend/prisma/schema.prisma), [auth](../../apps/backend/auth/createAuth.ts) | Resolve missing intended semantics, retention justification and manual process |
| Public browser-submission admission and internal grants | Browser execution versus server storage/verification, private versus shared/scored, visible features; [admission](../../apps/backend/firstStack/admission.ts), [submission routes](../../apps/backend/firstStack/submissionRoutes.ts), [internal routes](../../apps/backend/firstStack/routes.ts) | Keep inactive/internal status explicit until the published release changes it |
| Sharing, scoring and certificates | No public gallery or professional accreditation inferred from model fields; [submission routes](../../apps/backend/firstStack/submissionRoutes.ts), [scoring labels](../../apps/backend/firstStack/scoredChallenges/definition.ts) | Confirm actual sharing/issuance and review/correction rules |
| Neon project and recovery history | Database processor, region, retention and restored personal data; [bootstrap](../PRODUCTION_BOOTSTRAP.md) | Verify actual settings; no India-only storage or fixed provider history asserted |
| AWS EC2 host and operational access | Backend processing, region, logs, security and incident response; [deployment](../DEPLOYMENT.md), [bootstrap](../PRODUCTION_BOOTSTRAP.md) | Verify owner-operated controls rather than infer live configuration |
| S3 backup installation and lifecycle | Daily/weekly copies, 7/28-day age windows, one-day noncurrent expiry, asynchronous cleanup; local latest copy has no fixed maximum; [backup runbook](../operations/backup-alerts.md) | Confirm enabled installation and restore/erasure handling; windows are not a universal deletion deadline |
| Application, proxy, system and provider logs | Collected metadata, retention and access; [auth logger](../../apps/backend/auth/createAuth.ts), [request errors](../../apps/backend/utils/middleware.ts), [journal guidance](../operations/backup-alerts.md) | Set actual periods; 7/28 days describes S3 backups, not logs |
| Vercel frontend/project and Web Analytics | Frontend request metadata, page-view collection and possible consent requirement; [App](../../apps/web/src/app/App.tsx), [bootstrap](../PRODUCTION_BOOTSTRAP.md), [Vercel privacy docs](https://vercel.com/docs/analytics/privacy-policy) | Confirm whether collection is active, exact data, retention and controls; cookie-free is a vendor description, not a compliance finding |
| Cloudflare Turnstile or hosting protection | Bot-check network/browser data, tokens and any additional cookies | No Turnstile app integration established; disclose only after verified configuration and cookie audit |
| HTTPS/API host and sign-in request options | Secure prefix, host-only cookie scope, seven-day session default, conditional nonpersistent/state cookies; [settings](../../apps/backend/auth/settings.ts), [auth docs](../AUTHENTICATION.md), [pinned library](https://github.com/better-auth/better-auth/blob/v1.7.7/packages/better-auth/src/cookies/index.ts) | Audit actual Set-Cookie across frontend/API domains; no live audit claimed |
| Browser feature usage and browser lifecycle | Drafts/preferences/hints persist in local storage; internal drafts use session storage; Cookie Notice inventory cites each source | Clear shared-device data; do not promise sign-out deletes drafts or server records |
| International destinations, contracts and safeguards | Provider/subprocessor disclosure, GDPR transfers and Indian transfer restrictions | Confirm regions and agreements; no SCC or adequacy arrangement inferred |
| Optional processing, consent and rights operations | Lawful bases, withdrawal, request deadlines, human review and age handling | Approve and implement the process; the drafts do not implement consent or request controls |
| Future payments and service commitments | Fees, refunds, certificates, suspension, liability and changes to terms | Approve proposed terms and add payment-specific disclosures before charging; no invented fee, cap or SLA |

## Legal reference and commencement review

The India section is a baseline for the DPDP Act 2023, not a statement that every provision is already in force. The [official commencement notification, G.S.R. 843(E)](https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf) phases commencement; core processing duties and rights are in its eighteen-month group. The [2025 Rules, rule 1](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf) also phase commencement. Recheck current notifications and other applicable Indian obligations with counsel at publication; do not advertise compliance based on these drafts. Rights and purpose/retention commitments need operational support.

The EU baseline is conditional on GDPR applicability, not merely citizenship. Assess territorial scope, lawful bases, rights handling, transfer safeguards, child rules and representation before publication. The [official GDPR text](https://eur-lex.europa.eu/eli/reg/2016/679/) is the reference. No representation agreement or transfer contract is asserted to exist.

## Complete owner placeholder register

The register below reproduces every distinct placeholder from the three draft notices. Location links identify its occurrence. Recommended defaults above do not resolve a placeholder or claim a configuration has changed.

| Location | Placeholder |
| --- | --- |
| [terms-of-service.md:5](terms-of-service.md) | [OWNER: T01 - Set the effective date after legal review and publication approval.] |
| [terms-of-service.md:9](terms-of-service.md) | [OWNER: T02 - Give the founder's full legal name and trading name, or the legal entity if one is formed.] |
| [terms-of-service.md:9](terms-of-service.md) | [OWNER: T03 - Provide the legal service address.] |
| [terms-of-service.md:9](terms-of-service.md) | [OWNER: T04 - Provide a monitored support and legal contact email.] |
| [terms-of-service.md:11](terms-of-service.md) | [OWNER: T05 - Approve the acceptance mechanism, minimum age and eligibility rules; recommended initial policy is adults aged 18 or over until a reviewed child-consent process exists.] |
| [terms-of-service.md:17](terms-of-service.md) | [OWNER: T06 - Confirm the covered Learning and Engineering names, domains and launch capabilities; do not describe internal-only features as generally available.] |
| [terms-of-service.md:23](terms-of-service.md) | [OWNER: T07 - Confirm whether certificates are offered, the issuer, eligibility and correction/revocation rules; omit certificate availability claims until verified.] |
| [terms-of-service.md:37](terms-of-service.md) | [OWNER: T08 - Confirm ownership, the service-use license and the scope of engine/scoring restrictions with counsel.] |
| [terms-of-service.md:41](terms-of-service.md) | [OWNER: T09 - Confirm the current free offering; add prices, taxes, renewal, cancellation, refunds and payment-provider disclosures before introducing payments. No paid plan or payment processing is promised by this draft.] |
| [terms-of-service.md:45](terms-of-service.md) | [OWNER: T10 - Approve suspension grounds, notice, appeal channel and service-shutdown notice period.] |
| [terms-of-service.md:53](terms-of-service.md) | [OWNER: T11 - Have counsel set a reasonable monetary liability cap, scope and exclusions, including treatment of a free service. Do not publish an invented amount or a zero-liability promise.] |
| [terms-of-service.md:59](terms-of-service.md) | [OWNER: T12 - Choose how material terms changes will be notified, their advance notice period and the acceptance process. Keep a dated version history.] |
| [terms-of-service.md:63](terms-of-service.md) | [OWNER: T13 - Choose the governing law and competent courts with counsel, preserving mandatory consumer protections and privacy complaint rights in the user's jurisdiction.] |
| [privacy-policy.md:5](privacy-policy.md) | [OWNER: P01 - Set the effective date and confirm this policy matches the release being published.] |
| [privacy-policy.md:9](privacy-policy.md) | [OWNER: P02 - Insert the same legal operator name and service address as the Terms.] |
| [privacy-policy.md:9](privacy-policy.md) | [OWNER: P03 - Give the authorised grievance contact's name, role, monitored email and postal contact; identify a statutory officer only if applicable.] |
| [privacy-policy.md:37](privacy-policy.md) | [OWNER: P04 - Reconcile the intended new deletion, pseudonymisation, email-verification and password-reset implementation with the release; document exact data affected, delivery provider, expiry and user steps before promising those features.] |
| [privacy-policy.md:45](privacy-policy.md) | [OWNER: P05 - Choose whether to keep Vercel Analytics, remove it or select another provider; confirm actual fields, purpose, retention, legal basis and any required prior opt-in and withdrawal controls across both sites.] |
| [privacy-policy.md:47](privacy-policy.md) | [OWNER: P06 - Inventory application, proxy, host and provider logs; specify collected metadata, access controls and retention/deletion periods. Do not apply backup expiry windows to logs.] |
| [privacy-policy.md:63](privacy-policy.md) | [OWNER: P07 - Confirm the active provider list, regions, subprocessors, agreements and international data flows; remove unselected options from the published notice.] |
| [privacy-policy.md:65](privacy-policy.md) | [OWNER: P08 - Specify actual destinations and applicable transfer safeguards, including EU transfer mechanisms and how to obtain a copy; check Indian transfer restrictions. Do not assert adequacy, SCCs or India-only storage without evidence.] |
| [privacy-policy.md:73](privacy-policy.md) | [OWNER: P09 - Establish and publish a workable request process, identity checks, response deadlines and account-closure route; use a documented manual review until a verified self-service workflow exists.] |
| [privacy-policy.md:75](privacy-policy.md) | [OWNER: P10 - Set purpose-based retention periods for account data, verification records, designs, runs and evidence; define any necessary legal/security retention and the exact pseudonymisation procedure. Pseudonymised data remains personal data when it can still be linked to a person.] |
| [privacy-policy.md:79](privacy-policy.md) | [OWNER: P11 - Confirm backup installation, Neon recovery retention, local-copy limits and deletion handling after restore; establish how erasure requests and legal holds affect all copies without promising instant backup erasure.] |
| [privacy-policy.md:87](privacy-policy.md) | [OWNER: P12 - Confirm purposes and lawful bases, consent wording and records, withdrawal route, rights-response procedure and any EU representative requirement. Terms acceptance is not blanket privacy consent.] |
| [privacy-policy.md:91](privacy-policy.md) | [OWNER: P13 - Confirm actual score/certificate uses, any consequential automated decisions and an appropriate human review route.] |
| [privacy-policy.md:95](privacy-policy.md) | [OWNER: P14 - Approve the age policy and handling of child data; recommended initial scope is adults only. Do not claim age verification or parental-consent controls exist without testing them.] |
| [privacy-policy.md:97](privacy-policy.md) | [OWNER: P15 - Confirm operational access controls and the incident response and legally required breach-notification procedure.] |
| [privacy-policy.md:99](privacy-policy.md) | [OWNER: P16 - Choose policy-change notification and version-history arrangements; obtain fresh consent when a changed purpose legally requires it.] |
| [cookie-notice.md:5](cookie-notice.md) | [OWNER: C01 - Set the effective date and validate this inventory on the release domains.] |
| [cookie-notice.md:15](cookie-notice.md) | [OWNER: C02 - Capture actual Set-Cookie names, host, purpose, flags and lifetimes for credential sign-in/out and each enabled OAuth flow; confirm conditional dont_remember/state cookies and exclude disabled session-cache cookies. This source inventory is not a live-cookie audit.] |
| [cookie-notice.md:36](cookie-notice.md) | [OWNER: C03 - Verify cookies/storage on both sites, hosting protection and enabled provider/bot-check flows; list any additions with purpose and duration, or remove unselected services from publication.] |
| [cookie-notice.md:42](cookie-notice.md) | [OWNER: C04 - Decide which storage needs prior consent in the served jurisdictions and provide working optional-storage controls, including rejection and withdrawal; do not claim a consent banner or analytics opt-out already exists.] |
