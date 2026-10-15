import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildDBClient, migrateDB, SqliteQueue } from "liteque";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Exercises liteque as patched in patches/liteque@0.10.0.patch: idempotency
// keys only dedupe jobs that are still queued. Lives here rather than with the
// queue plugin because CI doesn't run the plugins tests.
describe("liteque idempotency keys", () => {
  let dir: string;
  let queue: SqliteQueue<{ bookmarkId: string }>;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "liteque-idempotency-"));
    const db = buildDBClient(path.join(dir, "queue.db"));
    migrateDB(db);
    queue = new SqliteQueue("test", db, {
      defaultJobArgs: { numRetries: 0 },
      keepFailedJobs: false,
    });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("dedupes jobs that are still queued", async () => {
    const first = await queue.enqueue(
      { bookmarkId: "b1" },
      { idempotencyKey: "index:b1" },
    );
    const second = await queue.enqueue(
      { bookmarkId: "b1" },
      { idempotencyKey: "index:b1" },
    );
    expect(first).toBeDefined();
    expect(second).toBeUndefined();
  });

  it("accepts the same key once the earlier job is running", async () => {
    await queue.enqueue({ bookmarkId: "b1" }, { idempotencyKey: "index:b1" });
    const running = await queue.attemptDequeue({ timeoutSecs: 30 });
    expect(running?.status).toBe("running");

    const followUp = await queue.enqueue(
      { bookmarkId: "b1" },
      { idempotencyKey: "index:b1" },
    );
    expect(followUp).toBeDefined();

    // And the follow-up dedupes later requests while it waits
    const third = await queue.enqueue(
      { bookmarkId: "b1" },
      { idempotencyKey: "index:b1" },
    );
    expect(third).toBeUndefined();
  });
});
