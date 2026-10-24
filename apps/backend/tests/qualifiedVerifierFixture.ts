import type { ApprovedSubmissionEngine } from "../firstStack/admission";
import { isolationPolicyHash, qualificationChecks, type HostQualification } from "../firstStack/isolationPolicy";
import type { SubmissionVerifier } from "../firstStack/submissionWorker";
import { verifierProtocolFixture } from "./verifierProtocolFixture";

// Synthetic protocol authority only; this is not a production host qualification.
// Ten minutes exceeds the integration test's three-minute deadline.
export function qualifiedVerifierFixture(engine: ApprovedSubmissionEngine, beforeCut: () => Promise<void> = async () => {}) {
  const fixture = verifierProtocolFixture(engine, beforeCut), now = Date.now();
  const qualification: HostQualification = { schema: "first-stack-host/1", target: "ec2-c7i-flex.large",
    ...engine, daemon: fixture.control.identity, policy: isolationPolicyHash, capacity: 1, qualified: true,
    checkedAt: new Date(now).toISOString(), expiresAt: new Date(now + 600000).toISOString(),
    checks: Object.fromEntries(qualificationChecks.map(key => [key, true])) as HostQualification["checks"] };
  const configuration: SubmissionVerifier = { admission: { enabled: true, engine },
    isolation: { ...engine, qualification }, control: fixture.control, healthy: () => true };
  return { fixture, configuration };
}
