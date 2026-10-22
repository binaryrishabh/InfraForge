DRAFT for owner and legal review. Not legal advice.

# InfraForge Terms of Service

Effective date: [OWNER: T01 - Set the effective date after legal review and publication approval.]

## Who provides the service

InfraForge is a distributed-systems and cloud design simulator for learners and engineers. Its owner is an individual founder in India. Your agreement is with [OWNER: T02 - Give the founder's full legal name and trading name, or the legal entity if one is formed.], at [OWNER: T03 - Provide the legal service address.]. Contact: [OWNER: T04 - Provide a monitored support and legal contact email.].

These are proposed contract terms, not a statement that a sign-up acceptance mechanism or every policy below has already been implemented. [OWNER: T05 - Approve the acceptance mechanism, minimum age and eligibility rules; recommended initial policy is adults aged 18 or over until a reviewed child-consent process exists.]

## What InfraForge does

You can design simulated infrastructure and inspect recorded runs and challenge results. In the browser execution path, simulations run on your device; saved submissions go to the server, which verifies scored/shared submissions. That submission router is implemented but deliberately not mounted in the public API in this checkout. Existing and internal execution paths also run on the server; the deployment record identifies Model 1 as active and Model 2 as internal. Availability of an internal path does not mean it is offered to every account. See [browser execution](../../apps/web/src/firstStack/worker/execute.ts), [submission admission](../../apps/backend/firstStack/admission.ts), [server verification](../../apps/backend/firstStack/submissionWorker.ts), [public admission status](../../apps/backend/firstStack/submissionRoutes.ts), [internal access](../../apps/backend/firstStack/routes.ts) and [deployment status](../DEPLOYMENT.md).

The Learning and Engineering sites must explain the capabilities actually available on each site. [OWNER: T06 - Confirm the covered Learning and Engineering names, domains and launch capabilities; do not describe internal-only features as generally available.]

## Simulation results, scores and certificates

A simulated deployment is not a promise about a real cloud deployment. Read each result's assumptions, evidence labels, omissions and Unknown values. Cloud timing is assumption-only; physical throughput, full resident memory, physical database buffer hits and full cost can be Unknown. A supported subtotal is not necessarily the full cost. See [report limitations](../../apps/backend/firstStack/report.ts) and [scoring support labels](../../apps/backend/firstStack/scoredChallenges/definition.ts).

Scores, and any certificates offered with them, describe performance in a simulation under its stated assumptions and scoring version. They do not guarantee real cloud latency, uptime, scalability, security, cost, employment suitability or professional accreditation. [OWNER: T07 - Confirm whether certificates are offered, the issuer, eligibility and correction/revocation rules; omit certificate availability claims until verified.]

Use your own testing and professional judgment before making a real engineering or spending decision. You remain responsible for your real infrastructure.

## Your account and content

Keep your credentials private and use an account you are entitled to use. Do not impersonate someone else. Report suspected misuse to the contact above. Username/email/password sign-in exists; Google and GitHub sign-in depend on configuration. Email verification is not required in the reviewed checkout, and working verification email/password-reset delivery is not configured there. See [authentication](../AUTHENTICATION.md) and [auth configuration](../../apps/backend/auth/createAuth.ts).

You retain rights you have in designs and other content you submit. You give the operator permission to store, process, display back to you and verify that content as needed to provide the service. This does not grant public redistribution rights over your private designs. Do not submit credentials, production secrets, personal data about others or material you have no right to use. The [Privacy Policy](privacy-policy.md) describes stored account and run data.

## Acceptable use and intellectual property

You may use the available interface for your own learning and engineering evaluation. Do not attack the service, overload or evade its limits, access another user's records, introduce malicious content, falsify results, bypass scoring protections, scrape hidden tests or use accounts to manipulate scores.

Except to the extent a mandatory law or a separate applicable license permits it, do not reverse engineer, decompile, extract, copy for redistribution, sell or redistribute InfraForge's engine, scoring content or hidden tests without written permission. Ordinary use of the browser-delivered engine through the service is permitted. Third-party open-source components remain subject to their own licenses; these terms do not remove rights those licenses grant. [OWNER: T08 - Confirm ownership, the service-use license and the scope of engine/scoring restrictions with counsel.]

## Fees

[OWNER: T09 - Confirm the current free offering; add prices, taxes, renewal, cancellation, refunds and payment-provider disclosures before introducing payments. No paid plan or payment processing is promised by this draft.]

## Suspension, termination and deletion requests

The proposed policy permits the operator to restrict or end access for serious or repeated misuse, legal requirements or a service shutdown. Where practicable, explain the reason and allow a response; urgent security cases may require immediate action. [OWNER: T10 - Approve suspension grounds, notice, appeal channel and service-shutdown notice period.]

You may stop using the service and ask the privacy contact to close your account or erase data. Ending access and erasing stored data are separate actions. This checkout does not establish a working account deletion or pseudonymised-retention workflow; do not assume sign-out or deleting a design erases historical runs. See the [retention and deletion section](privacy-policy.md#retention-and-deletion). Mandatory privacy rights remain available where applicable.

## Warranties and liability

To the extent permitted by law, the service and its simulation results are provided as available, without a warranty that they are accurate, uninterrupted, secure, error-free or suitable for a particular purpose. There is no service-level guarantee in these proposed terms. This does not exclude mandatory consumer rights or duties that cannot lawfully be excluded.

To the extent permitted by law, the proposed terms exclude liability for indirect or consequential loss, lost profits and losses from relying on simulation results for real systems. [OWNER: T11 - Have counsel set a reasonable monetary liability cap, scope and exclusions, including treatment of a free service. Do not publish an invented amount or a zero-liability promise.]

No exclusion or cap applies where the law prohibits it, including fraud or other liability that cannot be limited. These terms do not waive statutory privacy remedies.

## Changes and disputes

[OWNER: T12 - Choose how material terms changes will be notified, their advance notice period and the acceptance process. Keep a dated version history.]

If you disagree with new terms, you may stop using the service and request account closure. Do not treat acceptance of contract changes as consent to unrelated data processing.

Governing law and courts: [OWNER: T13 - Choose the governing law and competent courts with counsel, preserving mandatory consumer protections and privacy complaint rights in the user's jurisdiction.]

For questions or disputes, use the legal contact above. Privacy complaints follow the [Privacy Policy](privacy-policy.md).
