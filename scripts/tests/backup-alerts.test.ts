import { expect, test } from "bun:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const template = await Bun.file(resolve(root, "ops/backup-alerts/stack.json")).json();

test("backup template keeps storage private, encrypted, versioned and retained", () => {
  const bucket = template.Resources.BackupBucket;
  expect(bucket.DeletionPolicy).toBe("Retain");
  expect(bucket.UpdateReplacePolicy).toBe("Retain");
  expect(Object.values(bucket.Properties.PublicAccessBlockConfiguration)).toEqual([true, true, true, true]);
  expect(bucket.Properties.VersioningConfiguration.Status).toBe("Enabled");
  expect(bucket.Properties.BucketEncryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault.SSEAlgorithm).toBe("AES256");
  expect(bucket.Properties.LifecycleConfiguration.Rules.slice(0, 2).map((rule: { ExpirationInDays: number }) => rule.ExpirationInDays)).toEqual([7, 28]);
  const statements = template.Resources.HostPolicy.Properties.PolicyDocument.Statement;
  expect(statements.map((statement: { Action: string }) => statement.Action)).toEqual(["s3:PutObject", "cloudwatch:PutMetricData"]);
  expect(statements[0].Resource.map((resource: Record<string, string>) => resource["Fn::Sub"])).toEqual([
    "${BackupBucket.Arn}/backups/daily/*", "${BackupBucket.Arn}/backups/weekly/*",
  ]);
  expect(statements[1].Condition.StringEquals["cloudwatch:namespace"]).toBe("InfraForge/Ops");
});

test("all seven alarms notify email and fail on missing metrics", () => {
  const alarms = Object.values(template.Resources).filter((resource: any) => resource.Type === "AWS::CloudWatch::Alarm") as any[];
  expect(alarms).toHaveLength(7);
  for (const { Properties: properties } of alarms) {
    expect(properties.TreatMissingData).toBe("breaching");
    expect(properties.AlarmActions).toEqual([{ Ref: "Alerts" }]);
    expect(properties.Dimensions).toEqual([{ Name: "InstanceId", Value: { Ref: "InstanceId" } }]);
  }
  expect(template.Resources.BackupAlarm.Properties.Threshold).toBe(26 * 3600);
  expect(template.Resources.Email.Properties.Protocol).toBe("email");
});

test("operations runner passes offline upload, isolation and failure regressions", () => {
  const result = Bun.spawnSync([process.platform === "win32" ? "python" : "python3", "-B", "ops/backup-alerts/test_runner.py"], { cwd: root });
  expect(result.stderr.toString()).toContain("Ran 20 tests");
  expect(result.stderr.toString()).toContain("OK");
  expect(result.exitCode).toBe(0);
}, 30_000);

test("backup launcher passes bash syntax check", () => {
  const result = Bun.spawnSync(["bash", "-n", "ops/backup-alerts/run.sh"], { cwd: root });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
});
