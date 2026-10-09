import { Client } from "pg";

// One simulator host per database. This requires a session-preserving connection.
const LOCK = [186542854, 1];

export class WorkerOwnership {
  private held = false;
  private closing = false;

  private constructor(private readonly client: Client, private readonly onLost: () => void) {
    client.on("error", () => this.lose());
    client.on("end", () => { if (!this.closing) this.lose(); });
  }

  static async acquire(databaseUrl: string, onLost: () => void): Promise<WorkerOwnership> {
    const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000, query_timeout: 5000 });
    const ownership = new WorkerOwnership(client, onLost);
    try {
      await client.connect();
      const result = await client.query("SELECT pg_try_advisory_lock($1, $2) AS acquired", LOCK);
      if (!result.rows[0]?.acquired) throw new Error("Another InfraForge worker owns this database. Stop it before starting a replacement.");
      ownership.held = true;
      return ownership;
    } catch (error) {
      ownership.closing = true;
      await client.end();
      throw error;
    }
  }

  private lose() {
    if (this.held) {
      this.held = false;
      this.onLost();
    }
  }

  async assertHeld() {
    if (!this.held) throw new Error("Worker ownership lost");
    try {
      const result = await this.client.query(`SELECT EXISTS (
        SELECT 1 FROM pg_locks WHERE pid = pg_backend_pid() AND locktype = 'advisory'
          AND classid = $1::oid AND objid = $2::oid AND objsubid = 2 AND granted
      ) AS held`, LOCK);
      if (!result.rows[0]?.held) throw new Error("Worker ownership lost");
    } catch (error) {
      this.lose();
      throw error;
    }
  }

  async close() {
    this.closing = true;
    if (this.held) await this.client.query("SELECT pg_advisory_unlock($1, $2)", LOCK);
    this.held = false;
    await this.client.end();
  }
}
