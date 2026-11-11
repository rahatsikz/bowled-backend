/**
 * API-owned DB facade over @bowled/db. The API process creates its pool in
 * index.ts, injects it here, and closes it via close() on shutdown. The
 * interface is limited to the operations the API actually uses; the worker
 * composes its own from the same package.
 */

import type { DbPool, DeliveryWithReport } from "@bowled/db";
import { makeDeliveriesDb, makeDevicesDb, makeUsersDb } from "@bowled/db";

type DeliveriesDb = ReturnType<typeof makeDeliveriesDb>;

export type ApiDb = Pick<DeliveriesDb, "insertDelivery" | "getDeliveryWithReport"> &
  ReturnType<typeof makeUsersDb> &
  Pick<ReturnType<typeof makeDevicesDb>, "upsertDevice"> & {
    /** Close the API's pool. */
    close(): Promise<void>;
  };

export function makeApiDb(pool: DbPool): ApiDb {
  const users = makeUsersDb(pool);
  const devices = makeDevicesDb(pool);
  const deliveries = makeDeliveriesDb(pool);

  return {
    upsertUserByKey: users.upsertUserByKey,
    upsertDevice: devices.upsertDevice,
    insertDelivery: deliveries.insertDelivery,
    getDeliveryWithReport: deliveries.getDeliveryWithReport,
    close: () => pool.end(),
  };
}
