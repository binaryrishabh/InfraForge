import { randomUUID } from "node:crypto";
import type { LocalHarness } from "./localHarness";

// Fail real fixture writes until the test releases them. Sequence increments
// survive transaction rollback, so the caller can observe repeated attempts.
export async function traceProbe(harness: LocalHarness, runId: string, blockedSecond: number, terminalBlocked: boolean) {
  if (!/^[a-f0-9-]{36}$/.test(runId) || !Number.isInteger(blockedSecond)) throw new Error("Invalid owned trace probe");
  const name = `trace_probe_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const connection = await harness.sql.connect();
  try {
    await connection.query("BEGIN");
    await connection.query(`CREATE TABLE ${name} (sample_block BOOLEAN NOT NULL, terminal_block BOOLEAN NOT NULL);
      INSERT INTO ${name} VALUES (true,${terminalBlocked});
      CREATE SEQUENCE ${name}_sample; CREATE SEQUENCE ${name}_terminal;
      CREATE FUNCTION ${name}_sample_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW."deploymentId"='${runId}' AND NEW."simulatedSeconds"=${blockedSecond} AND (SELECT sample_block FROM ${name}) THEN
          PERFORM nextval('${name}_sample'); RAISE EXCEPTION 'owned experiment batch write blocked';
        END IF; RETURN NEW; END $$;
      CREATE TRIGGER ${name}_sample BEFORE INSERT ON "RunEvidenceSample" FOR EACH ROW EXECUTE FUNCTION ${name}_sample_fn();
      CREATE FUNCTION ${name}_action_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW."deploymentId"='${runId}' AND NEW.kind='chaos' AND NEW.parameters->>'trigger'='challenge-experiment' AND
          (SELECT count(*) FROM "RunEvidenceSample" WHERE "deploymentId"=NEW."deploymentId" AND "simulatedSeconds" BETWEEN 30 AND 60) <> 31 THEN
          RAISE EXCEPTION 'fault boundary preceded durable tick evidence';
        END IF; RETURN NEW; END $$;
      CREATE TRIGGER ${name}_action BEFORE INSERT ON "RunAction" FOR EACH ROW EXECUTE FUNCTION ${name}_action_fn();
      CREATE FUNCTION ${name}_terminal_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.id='${runId}' AND NEW."terminalSnapshot" IS NOT NULL THEN
          IF (SELECT count(*) FROM "RunEvidenceSample" WHERE "deploymentId"=NEW.id) <> (NEW."terminalSnapshot"->>'simulatedSeconds')::integer - 29 THEN
            RAISE EXCEPTION 'terminal capture preceded durable tick evidence';
          END IF;
          IF (SELECT terminal_block FROM ${name}) THEN PERFORM nextval('${name}_terminal'); RAISE EXCEPTION 'owned experiment terminal write blocked'; END IF;
        END IF; RETURN NEW; END $$;
      CREATE TRIGGER ${name}_terminal BEFORE UPDATE ON "Deployment" FOR EACH ROW EXECUTE FUNCTION ${name}_terminal_fn()`);
    await connection.query("COMMIT");
  } catch (error) { await connection.query("ROLLBACK"); throw error; }
  finally { connection.release(); }
  const attempts = async (kind: "sample" | "terminal") => {
    const row = (await harness.sql.query(`SELECT last_value::int, is_called FROM ${name}_${kind}`)).rows[0];
    return row.is_called ? row.last_value as number : 0;
  };
  return { attempts,
    releaseSamples: () => harness.sql.query(`UPDATE ${name} SET sample_block=false`),
    releaseTerminal: () => harness.sql.query(`UPDATE ${name} SET terminal_block=false`),
    close: async () => {
      await harness.sql.query(`DROP TRIGGER ${name}_sample ON "RunEvidenceSample"; DROP TRIGGER ${name}_action ON "RunAction"; DROP TRIGGER ${name}_terminal ON "Deployment";
        DROP FUNCTION ${name}_sample_fn(); DROP FUNCTION ${name}_action_fn(); DROP FUNCTION ${name}_terminal_fn();
        DROP SEQUENCE ${name}_sample; DROP SEQUENCE ${name}_terminal; DROP TABLE ${name}`);
    } };
}
