/**
 * @bowled/db — shared database access for every backend process.
 *
 * Domain groups (users, devices, deliveries, analyses) are factories over a
 * caller-owned pool: each process creates its pool with createDbPool(),
 * composes the groups it needs, and closes the pool on shutdown. No pool is
 * created at module load and no process shares a pool.
 *
 * The schema is authoritative in packages/shared/src/db/schema.sql; every
 * query in this package follows it.
 */

export { createDbPool, type DbPool, type DbPoolOptions } from "./pool.js";
export { makeUsersDb } from "./users.js";
export { makeDevicesDb } from "./devices.js";
export { makeDeliveriesDb, type DeliveryWithReport } from "./deliveries.js";
export { makeAnalysesDb } from "./analyses.js";
