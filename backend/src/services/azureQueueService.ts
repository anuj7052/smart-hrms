/**
 * Azure Queue Storage service
 *
 * Used for asynchronous background processing:
 *   - eSSL device punch processing (decouples device push from DB writes)
 *   - Email notifications (no longer block API responses)
 *   - Attendance log generation from raw punches
 *
 * Environment variables required:
 *   AZURE_STORAGE_CONNECTION_STRING (shared with Blob Service)
 *   AZURE_QUEUE_NAME (default: hrms-jobs)
 */
import { QueueServiceClient, QueueClient } from '@azure/storage-queue';

let queueClient: QueueClient | null = null;

function getQueue(): QueueClient {
  if (queueClient) return queueClient;

  const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connStr) {
    throw new Error('AZURE_STORAGE_CONNECTION_STRING is not configured');
  }

  const queueName = process.env.AZURE_QUEUE_NAME || 'hrms-jobs';
  const serviceClient = QueueServiceClient.fromConnectionString(connStr);
  queueClient = serviceClient.getQueueClient(queueName);
  return queueClient;
}

export async function initQueue(): Promise<void> {
  if (!process.env.AZURE_STORAGE_CONNECTION_STRING) {
    console.log('[AzureQueue] Skipped — AZURE_STORAGE_CONNECTION_STRING not set');
    return;
  }
  try {
    const queue = getQueue();
    await queue.createIfNotExists();
    console.log('[AzureQueue] Queue ready');
  } catch (err) {
    console.error('[AzureQueue] Init failed:', (err as Error).message);
  }
}

export type JobType =
  | 'process-essl-punch'
  | 'send-email'
  | 'generate-attendance-log'
  | 'sync-device';

export interface QueueJob<T = unknown> {
  type: JobType;
  payload: T;
  enqueuedAt: string;
}

/**
 * Enqueue a job. Azure Queue requires base64 encoding for binary safety.
 */
export async function enqueueJob<T>(type: JobType, payload: T): Promise<void> {
  const queue = getQueue();
  const job: QueueJob<T> = { type, payload, enqueuedAt: new Date().toISOString() };
  const message = Buffer.from(JSON.stringify(job)).toString('base64');
  await queue.sendMessage(message);
}

/**
 * Poll and process up to `maxMessages` jobs. Use this in a worker loop.
 * Returns number of messages processed.
 */
export async function processNextJobs(
  handler: (job: QueueJob) => Promise<void>,
  maxMessages = 10
): Promise<number> {
  const queue = getQueue();
  const response = await queue.receiveMessages({ numberOfMessages: maxMessages, visibilityTimeout: 60 });
  let processed = 0;

  for (const msg of response.receivedMessageItems) {
    try {
      const decoded = Buffer.from(msg.messageText, 'base64').toString('utf8');
      const job: QueueJob = JSON.parse(decoded);
      await handler(job);
      await queue.deleteMessage(msg.messageId, msg.popReceipt);
      processed++;
    } catch (err) {
      console.error('[AzureQueue] Job failed:', (err as Error).message);
      // Message will become visible again after visibilityTimeout for retry
    }
  }

  return processed;
}
