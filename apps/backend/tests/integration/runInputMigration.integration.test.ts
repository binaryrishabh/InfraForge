import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { Pool } from "pg";
import { readLocalSettings } from "./localHarness";
import { layout, workload } from "./scenario";

const integration = process.env.INTEGRATION_RUN === "1" ? describe : describe.skip;

integration("additive run-input migration", () => {
  test("preserves records created under the previous schema without backfilling inputs", async () => {
    const settings = readLocalSettings(process.env);
    const admin = new Pool({ connectionString: settings.databaseUrl, ssl: false, options: "" });
    const name = `infraforge_it_${randomUUID().replaceAll("-", "")}`;
    const url = new URL(settings.databaseUrl);
    url.pathname = "/" + name;
    const database = new Pool({ connectionString: url.toString(), ssl: false, options: "" });
    let created = false;
    try {
      // Both identifiers are generated hex names on the guarded disposable server.
      const identity = await admin.query("SELECT current_database() AS name");
      expect(identity.rows[0].name).toBe(settings.databaseName);
      await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
      created = true;
      const migrations = new URL("../../prisma/migrations/", import.meta.url);
      const folders = (await readdir(migrations, { withFileTypes: true })).filter((entry) => entry.isDirectory())
        .map((entry) => entry.name).filter((name) => name <= "20261009000000_capture_run_inputs").sort();
      expect(folders.at(-1)).toBe("20261009000000_capture_run_inputs");
      for (const folder of folders.slice(0, -1)) {
        await database.query(await Bun.file(new URL(`${folder}/migration.sql`, migrations)).text());
      }
      const infrastructureId = randomUUID();
      await database.query(`INSERT INTO "Infrastructure" (id, "userId", name, layout, "updatedAt")
        VALUES ($1, 'legacy-owner', 'Preserved design', $2, '2026-10-01T00:00:00Z')`, [infrastructureId, JSON.stringify(layout)]);
      for (const status of ["completed", "pending", "live"]) {
        await database.query(`INSERT INTO "Deployment" (id, "infrastructureId", status, seed, "workloadProfile", timeline, "simulationState", "updatedAt")
          VALUES ($1, $2, $3, 'legacy-seed', $4, $5, $6, '2026-10-01T00:00:00Z')`, [randomUUID(), infrastructureId, status,
          JSON.stringify(workload), JSON.stringify([{ event: "Existing history", message: "keep" }]), JSON.stringify({ simulatedSeconds: 50 })]);
      }
      const beforeDesign = (await database.query('SELECT * FROM "Infrastructure"')).rows;
      const beforeRuns = (await database.query('SELECT * FROM "Deployment" ORDER BY id')).rows;
      await database.query(await Bun.file(new URL(`${folders.at(-1)}/migration.sql`, migrations)).text());
      expect((await database.query('SELECT * FROM "Infrastructure"')).rows).toEqual(beforeDesign);
      const after = (await database.query('SELECT * FROM "Deployment" ORDER BY id')).rows;
      expect(after).toHaveLength(3);
      for (let i = 0; i < after.length; i++) {
        const { runInputs, liveTopology, topologyRevision, runtimeActive, ...preserved } = after[i];
        expect(preserved).toEqual(beforeRuns[i]);
        expect(runInputs).toBeNull();
        expect(liveTopology).toBeNull();
        expect(topologyRevision).toBe(0);
        expect(runtimeActive).toBe(false);
      }
    } finally {
      await database.end();
      if (created) await admin.query(`DROP DATABASE "${name}"`);
      await admin.end();
    }
  }, 20000);
});
