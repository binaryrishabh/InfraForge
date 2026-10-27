// Keep pg and warning instrumentation out of other test files. No database or sockets are opened.
import { spyOn } from "bun:test";
import { strict as assert } from "node:assert";
import { Client } from "pg";
import { acquireVerifierOwnership } from "../firstStack/verifierOwnership";

// Exercise the installed driver's real query queue, replacing only connection/SQL transport.
const originalQuery = Client.prototype.query;
let pending = 0, peak = 0, ended = false, failNext = false;
const connect = spyOn(Client.prototype, "connect").mockImplementation(async function(this: any) {
  this.readyForQuery = true;
  return this;
});
const query = spyOn(Client.prototype, "query").mockImplementation(function(this: any) {
  const client = this;
  pending++; peak = Math.max(peak, pending);
  return new Promise((resolve, reject) => {
    const fail = failNext; failNext = false;
    const task = {
      callback: (error: Error | null, result: unknown) => { pending--; error ? reject(error) : resolve(result); },
      submit() {
        setImmediate(() => client._handleReadyForQuery({ status: "I" }));
      },
      handleReadyForQuery() { task.callback(fail ? Error("fixture query failed") : null, { rows: [{ held: true }] }); },
    };
    Reflect.apply(originalQuery, client, [task]);
  });
} as never);
const end = spyOn(Client.prototype, "end").mockImplementation(async () => {
  assert.equal(pending, 0, "Closing must wait for the pending check"); ended = true;
});
let lost = 0;
try {
  const ownership = await acquireVerifierOwnership("postgresql://fixture@localhost/fixture", () => { lost++; });
  // These are the three independent callers in submissionQueue.ts.
  await Promise.all([ownership.assertHeld(), ownership.assertHeld(), ownership.assertHeld()]);
  assert.equal(peak, 1, "Verifier checks overlap on the same pg Client");
  const check = ownership.assertHeld(), closing = ownership.close();
  await check; await closing;
  assert.equal(ended, true); assert.equal(pending, 0); assert.equal(lost, 0);
  await assert.rejects(ownership.assertHeld(), /ownership lost/);
  const replacement = await acquireVerifierOwnership("postgresql://fixture@localhost/fixture", () => { lost++; });
  failNext = true;
  await assert.rejects(replacement.assertHeld(), /fixture query failed/);
  await assert.rejects(replacement.assertHeld(), /ownership lost/);
  assert.equal(lost, 1);
  await replacement.close();
  console.info("Verifier checks serialize on the real pg query queue");
} finally { connect.mockRestore(); query.mockRestore(); end.mockRestore(); }
