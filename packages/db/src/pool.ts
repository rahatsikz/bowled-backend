/**
 * Pool factory. Each process (API, worker) creates, owns, and closes its own
 * pool via createDbPool(); no pool is created at module load. Pool creation
 * stays configurable so callers control connection settings and shutdown.
 */

import pg from "pg";

export type DbPool = pg.Pool;

export type DbPoolOptions = {
  /** Postgres connection string; when omitted, pg falls back to libpq env vars. */
  connectionString?: string;
};

export function createDbPool(options: DbPoolOptions = {}): DbPool {
  // DATABASE_URL wins; otherwise pg falls back to the libpq env vars
  // (PGHOST/PGUSER/PGPASSWORD/PGDATABASE) on its own.
  return new pg.Pool(
    options.connectionString ? { connectionString: options.connectionString } : {},
  );
}
