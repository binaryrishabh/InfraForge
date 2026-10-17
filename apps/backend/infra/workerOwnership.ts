import { Client } from "pg";

// One simulator host per database. This requires a session-preserving connection.
const LOCK = [186542854, 1];

export class WorkerOwnership {
  private held = false;
  private closing = false;
  private queue: Promise<unknown> = Promise.resolve();

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

  // The runtime, outbox poller and readiness probe check ownership every second.
  // Queue those checks like any other use of the session: issued while a lesson
  // transaction is open, pg would run them inside it, so a failed statement there
  // (or a statement held at a lock past the query timeout) looked like a lost lock.
  assertHeld() { return this.serial(() => this.checkHeld()); }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }

  private async checkHeld() {
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

  close() {
    this.closing = true;
    return this.serial(async () => {
      if (this.held) await this.client.query("SELECT pg_advisory_unlock($1, $2)", LOCK);
      this.held = false;
      await this.client.end();
    });
  }

  // Internal execution writes use the lock-holding session itself. Losing that
  // session rolls its transaction back before a replacement can own the worker.
  transaction<T>(operation: (client: Client) => Promise<T>): Promise<T> {
    return this.serial(async () => {
      await this.checkHeld();
      await this.client.query("BEGIN");
      try {
        const value = await operation(this.client);
        await this.checkHeld();
        await this.client.query("COMMIT");
        return value;
      } catch (error) { await this.client.query("ROLLBACK").catch(() => {}); throw error; }
    });
  }
}
