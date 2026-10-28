import { expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../lib/generated/prisma/client";
import { admitDeployment, claimDeployment } from "../../deployments/admission";
import { readOperationalLimits, reservationWhere } from "../../deployments/operationalLimits";
import { readLocalSettings } from "./localHarness";

(process.env.INTEGRATION_RUN === "1" ? test : test.skip)("Postgres admission serializes owners, global queue/active slots and durable release", async () => {
  const settings = readLocalSettings(process.env), name = `infraforge_it_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: settings.databaseUrl, max: 1 });
  const target = new URL(settings.databaseUrl); target.pathname = `/${name}`;
  await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
  const sql = new Pool({ connectionString: target.href, max: 1 });
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: target.href, max: 4 }) });
  const limits = { ...readOperationalLimits({}), global: 4, queued: 2 }; // small explicit limits exercise the locking
  try {
    const directory = new URL("../../prisma/migrations/", import.meta.url);
    const migrations = (await readdir(directory, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name).sort();
    for (const migration of migrations) await sql.query(await Bun.file(new URL(`${migration}/migration.sql`, directory)).text());
    const owners = await Promise.all(Array.from({ length: 6 }, () => db.user.create({ data: {
      id: randomUUID(), name: "Admission fixture", email: `${randomUUID()}@infraforge.test`, updatedAt: new Date(),
    } })));
    // Different designs defeat accidental serialization by a per-design lock.
    const designs = await Promise.all(owners.flatMap(owner => Array.from({ length: 3 }, () => db.infrastructure.create({ data: {
      userId: owner.id, ownerId: owner.id, name: "Admission design", layout: {},
    } }))));
    const submit = (i: number, policy = limits) => db.$transaction(tx => admitDeployment(tx, {
      id: randomUUID(), infrastructureId: designs[i]!.id, ownerId: designs[i]!.ownerId,
    }, policy), { maxWait: 10000, timeout: 10000 });
    const burst = async (indices: number[], policy = limits) => {
      const results = await Promise.allSettled(indices.map(i => submit(i, policy)));
      for (const result of results) if (result.status === "rejected") expect(result.reason.statusCode).toBe(429);
      return results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
    };
    const queued = await burst(designs.map((_, i) => i));
    expect(queued).toHaveLength(2);
    expect(await db.outbox.count()).toBe(2);
    expect(await Promise.all(queued.map(run => db.$transaction(tx => claimDeployment(tx, run.id))))).toEqual(["claimed", "claimed"]);
    const more = await burst(designs.map((_, i) => i)); expect(more).toHaveLength(2);
    expect(await db.deployment.count({ where: reservationWhere })).toBe(4);
    expect(await db.$transaction(tx => claimDeployment(tx, more[0]!.id))).toBe("busy");
    const used = new Set([...queued, ...more].map(run => run.ownerId));
    const unused = designs.findIndex(design => !used.has(design.ownerId));
    await rejects(submit(unused), /capacity/);
    // A rolled-back terminal write is not a released reservation.
    await rejects(db.$transaction(async tx => { await tx.deployment.update({ where: { id: queued[0]!.id }, data: { status: "failed" } }); throw Error("rollback"); }), /rollback/);
    await rejects(submit(unused), /capacity/);
    await db.deployment.update({ where: { id: queued[0]!.id }, data: { status: "failed" } });
    expect(await db.$transaction(tx => claimDeployment(tx, more[0]!.id))).toBe("claimed");
    expect(await submit(unused)).toMatchObject({ status: "pending" });
    // A nominal terminal status still consuming runtime retains its reservation.
    await db.deployment.update({ where: { id: queued[1]!.id }, data: { status: "torn-down", runtimeActive: true } });
    await rejects(submit(unused + 1), /capacity/);
    await db.deployment.update({ where: { id: queued[1]!.id }, data: { runtimeActive: false } });
    expect(await db.$transaction(tx => claimDeployment(tx, more[1]!.id))).toBe("claimed");
    expect(await submit(unused + 1)).toMatchObject({ status: "pending" });
    await db.deployment.updateMany({ data: { status: "failed", runtimeActive: false } });
    const ownerOnly = await burst([0, 1, 2], { ...limits, queued: 10, global: 10 });
    expect(ownerOnly).toHaveLength(2);
    await rejects(submit(0, { ...limits, inputBytes: 1 }), /byte budget/);
    // Work and outbox cannot survive a failed admission transaction.
    const before = await db.deployment.count(), outbox = await db.outbox.count();
    await rejects(db.$transaction(async tx => { await admitDeployment(tx, {
      infrastructureId: designs[unused]!.id, ownerId: designs[unused]!.ownerId,
    }, { ...limits, queued: 10, perOwner: 10 }); throw Error("rollback outbox"); }), /rollback outbox/);
    expect(await db.deployment.count()).toBe(before); expect(await db.outbox.count()).toBe(outbox);
    await sql.query('UPDATE "Deployment" SET "createdAt"=now()-interval \'31 minutes\' WHERE id=$1', [ownerOnly[0]!.id]);
    expect(await db.$transaction(tx => claimDeployment(tx, ownerOnly[0]!.id))).toBe("retired");
    expect((await db.deployment.findUniqueOrThrow({ where: { id: ownerOnly[0]!.id } })).status).toBe("failed");
  } finally { await db.$disconnect(); await sql.end(); await admin.query(`DROP DATABASE "${name}"`); await admin.end(); }
}, 60000);
