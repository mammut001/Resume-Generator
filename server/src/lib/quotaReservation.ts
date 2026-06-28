import { IncomingMessage } from 'node:http';
import { IntakeUsageStore } from '../intake/usageStore.js';

export async function withQuotaReservation(
  usageStore: IntakeUsageStore,
  req: IncomingMessage,
  work: () => Promise<void>,
): Promise<void> {
  const reservation = usageStore.createReservation(req);
  usageStore.consumeAttempt(req);

  try {
    await work();
  } catch (error) {
    usageStore.refundAttempt(req, reservation);
    throw error;
  }
}