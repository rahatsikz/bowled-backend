import type { Report } from '@bowled/shared';
import admin from 'firebase-admin';

// ---------------------------------------------------------------------------
// Notifier interface
// ---------------------------------------------------------------------------

export type Notifer = {
  deliveryComplete(pushToken: string, deliveryId: string): Promise<void>;
  deliveryFailed(pushToken: string, deliveryId: string, reason: string): Promise<void>;
};

// ---------------------------------------------------------------------------
// FCM notifier (requires a service-account key file)
// ---------------------------------------------------------------------------

export class FcmNotifier implements Notifer {
  constructor(private readonly serviceAccountPath: string) {
    if (!(admin as any).apps?.length) {
      const serviceAccount = require(serviceAccountPath);
      (admin as any).initializeApp({ credential: (admin as any).credential.cert(serviceAccount) });
    }
  }

  async deliveryComplete(pushToken: string, deliveryId: string): Promise<void> {
    try {
      // Placeholder: real FCM send would use admin.messaging().sendToDevice
      console.info(`FCM: delivery ${deliveryId} complete → ${pushToken.slice(0, 20)}…`);
      // For v1 we just log; the mobile app implements its own FCM flow.
      console.info(`FCM: delivery ${deliveryId} complete → ${pushToken.slice(0, 20)}…`);
    } catch (err) {
      console.error(`FCM send failed for delivery ${deliveryId}:`, err);
    }
  }

  async deliveryFailed(pushToken: string, deliveryId: string, reason: string): Promise<void> {
    console.error(`FCM: delivery ${deliveryId} failed (${reason}) → ${pushToken.slice(0, 20)}…`);
  }
}

// ---------------------------------------------------------------------------
// No-op notifier (used when FCM is not configured)
// ---------------------------------------------------------------------------

export class NoopNotifier implements Notifer {
  async deliveryComplete(_pushToken: string, _deliveryId: string): Promise<void> {
    console.info(`(noop) delivery ${_deliveryId} complete — no FCM configured`);
  }

  async deliveryFailed(_pushToken: string, _deliveryId: string, _reason: string): Promise<void> {
    console.info(`(noop) delivery ${_deliveryId} failed — no FCM configured`);
  }
}
