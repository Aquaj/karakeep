import Database from "better-sqlite3";

const BUSY_TIMEOUT_MS = 30_000;

interface OpenSqliteOptions {
  readOnly: boolean;
  walMode: boolean;
}

export function openSqliteDatabase(
  filename: string,
  options: OpenSqliteOptions,
) {
  const sqlite = new Database(filename, {
    // better-sqlite3 defaults to 5 s; on a saturated disk a single write can
    // take longer than that, and a thrown "database is locked" takes the
    // whole worker set down. Prefer stalling to crashing.
    timeout: BUSY_TIMEOUT_MS,
    ...(options.readOnly ? { readonly: true, fileMustExist: true } : {}),
  });

  if (!options.readOnly) {
    if (options.walMode) {
      sqlite.pragma("journal_mode = WAL");
      sqlite.pragma("synchronous = NORMAL");
    } else {
      sqlite.pragma("journal_mode = DELETE");
    }
  }
  sqlite.pragma("cache_size = -65536");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("temp_store = MEMORY");

  if (options.readOnly) {
    sqlite.pragma("query_only = ON");
  }

  return sqlite;
}
