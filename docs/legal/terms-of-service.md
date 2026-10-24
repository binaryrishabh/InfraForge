DRAFT for owner and legal review. Not legal advice.

# InfraForge Terms of Service

Effective date: [OWNER: set at publication]

## Who provides the service

InfraForge is a distributed-systems and cloud design simulator for learners and engineers. Its owner is an individual founder in India. Your agreement is with Rishabh Srivastava, trading as InfraForge, at 64/72 Mall Road, Kanpur, Uttar Pradesh 208001, India. Contact: lapwork24@gmail.com.

These draft terms do not implement a sign-up acceptance mechanism. You must be at least 18 years old to use InfraForge. The service is for adults only.

## What InfraForge does

You can design simulated infrastructure and inspect recorded runs and challenge results. In the browser execution path, simulations run on your device; saved submissions go to the server, which verifies scored/shared submissions. That submission router is implemented but deliberately not mounted in the public API in this checkout. Existing and internal execution paths also run on the server; the deployment record identifies Model 1 as active and Model 2 as internal. Availability of an internal path does not mean it is offered to every account. See [browser execution](../../apps/web/src/firstStack/worker/execute.ts), [submission admission](../../apps/backend/firstStack/admission.ts), [server verification](../../apps/backend/firstStack/submissionWorker.ts), [public admission status](../../apps/backend/firstStack/submissionRoutes.ts), [internal access](../../apps/backend/firstStack/routes.ts) and [deployment status](../DEPLOYMENT.md).

These terms cover InfraForge Learning and Engineering through the service interfaces made available to you. Internal or gated features are available only to accounts granted access.

## Simulation results, scores and certificates

A simulated deployment is not a promise about a real cloud deployment. Read each result's assumptions, evidence labels, omissions and Unknown values. Cloud timing is assumption-only; physical throughput, full resident memory, physical database buffer hits and full cost can be Unknown. A supported subtotal is not necessarily the full cost. See [report limitations](../../apps/backend/firstStack/report.ts) and [scoring support labels](../../apps/backend/firstStack/scoredChallenges/definition.ts).

Scores describe performance in a simulation under its stated assumptions and scoring version. They do not guarantee real cloud latency, uptime, scalability, security, cost, employment suitability or professional accreditation. No certificates are offered at launch. Scores are practice feedback, not decisions about a person. You can request human review through the support email above.

Use your own testing and professional judgment before making a real engineering or spending decision. You remain responsible for your real infrastructure.

## Your account and content

Keep your credentials private and use an account you are entitled to use. Do not impersonate someone else. Report suspected misuse to the contact above. Username/email/password sign-in exists; Google and GitHub sign-in depend on configuration. Email verification and password-reset APIs are implemented but disabled by default. When account essentials and a real email provider are enabled, credential sign-in requires verification, email links expire after 30 minutes and password reset revokes all sessions. Their user interfaces are still pending. See [authentication](../AUTHENTICATION.md) and [auth configuration](../../apps/backend/auth/createAuth.ts).

You retain rights you have in designs and other content you submit. You give the operator permission to store, process, display back to you and verify that content as needed to provide the service. This does not grant public redistribution rights over your private designs. Do not submit credentials, production secrets, personal data about others or material you have no right to use. The [Privacy Policy](privacy-policy.md) describes stored account and run data.

## Acceptable use and intellectual property

You may use the available interface for your own learning and engineering evaluation. Do not attack the service, overload or evade its limits, access another user's records, introduce malicious content, falsify results, bypass scoring protections, scrape hidden tests or use accounts to manipulate scores.

Except to the extent a mandatory law or a separate applicable license permits it, do not reverse engineer, decompile, extract, copy for redistribution, sell or redistribute InfraForge's engine, scoring content or hidden tests without written permission. Ordinary use of the browser-delivered engine through the service is permitted. Third-party open-source components remain subject to their own licenses; these terms do not remove rights those licenses grant.

## Fees

InfraForge is free at launch. Before charging anything, we will add paid terms covering prices, taxes, renewal, cancellation, refunds and the payment provider.

## Suspension, termination and deletion requests

We may suspend or end access for abuse, security attacks, illegal use or violation of the engine and scoring restrictions above. We will give notice and explain the reason where safe; urgent security cases may require immediate action. You can appeal a suspension through the support email above.

You may stop using the service and ask the privacy contact to close your account or erase data. Ending access and erasing stored data are separate actions. Deletion and export APIs exist behind the account-essentials setting; in-app controls will be available once enabled and their UI is complete. Deletion erases the profile and scrubs saved designs while retaining pseudonymised immutable run history. Export before deletion, which revokes access. Sign-out and deleting a design do not erase historical runs. See the [retention and deletion section](privacy-policy.md#retention-and-deletion). Mandatory privacy rights remain available where applicable.

## Warranties and liability

To the extent permitted by law, the service and its simulation results are provided as available, without a warranty that they are accurate, uninterrupted, secure, error-free or suitable for a particular purpose. There is no service-level guarantee in these proposed terms. This does not exclude mandatory consumer rights or duties that cannot lawfully be excluded.

To the extent permitted by law, the proposed terms exclude liability for indirect or consequential loss, lost profits and losses from relying on simulation results for real systems. InfraForge is an educational tool: simulation results are approximations and are not professional, engineering or financial advice, and you must not rely on them alone for decisions about real systems. To the extent permitted by law, our total aggregate liability for all claims relating to the service is limited to the greater of INR 500 or the amount you paid us for the service in the three months before the event giving rise to the claim.

No exclusion or cap applies where the law prohibits it, including fraud or other liability that cannot be limited. These terms do not waive statutory privacy remedies.

## Changes and disputes

We will give at least 14 days' notice of material changes by email and a site banner before they take effect. The dated version history below records revisions.

If you disagree with new terms, you may stop using the service and request account closure. Do not treat acceptance of contract changes as consent to unrelated data processing.

Governing law and courts: Indian law governs these terms, subject to mandatory protections in your jurisdiction. Subject to those mandatory protections, the courts at Kanpur Nagar, Uttar Pradesh (including the District and Sessions Court, Kanpur Nagar) have jurisdiction.

Before starting any legal proceedings, please contact us at lapwork24@gmail.com with a description of your concern and give us 30 days to try to resolve it informally. This does not limit statutory complaint rights that cannot be waived.

For questions or disputes, use the legal contact above. Privacy complaints follow the [Privacy Policy](privacy-policy.md).

## Version history

- 2026-10-23: Draft revised from current source and acting-owner launch decisions; not yet effective.
