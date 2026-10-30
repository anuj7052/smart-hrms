/**
 * Azure Blob Storage service
 *
 * Used for storing:
 *   - Profile photos
 *   - Attendance proof images (selfies on punch-in)
 *   - Leave attachments (medical certificates, etc.)
 *   - Exported reports (Excel, PDF)
 *
 * Environment variables required:
 *   AZURE_STORAGE_CONNECTION_STRING
 *   AZURE_BLOB_CONTAINER_NAME (default: hrms-files)
 */
import { BlobServiceClient, ContainerClient, BlockBlobUploadResponse } from '@azure/storage-blob';

let containerClient: ContainerClient | null = null;

function getContainer(): ContainerClient {
  if (containerClient) return containerClient;

  const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connStr) {
    throw new Error('AZURE_STORAGE_CONNECTION_STRING is not configured');
  }

  const containerName = process.env.AZURE_BLOB_CONTAINER_NAME || 'hrms-files';
  const blobServiceClient = BlobServiceClient.fromConnectionString(connStr);
  containerClient = blobServiceClient.getContainerClient(containerName);
  return containerClient;
}

/**
 * Initialize the container (create if not exists). Call this once on app startup.
 */
export async function initBlobContainer(): Promise<void> {
  if (!process.env.AZURE_STORAGE_CONNECTION_STRING) {
    console.log('[AzureBlob] Skipped — AZURE_STORAGE_CONNECTION_STRING not set');
    return;
  }
  try {
    const container = getContainer();
    await container.createIfNotExists({ access: 'blob' });
    console.log('[AzureBlob] Container ready');
  } catch (err) {
    console.error('[AzureBlob] Init failed:', (err as Error).message);
  }
}

export interface UploadOptions {
  folder?: string;       // e.g. 'profiles', 'attendance-proofs'
  contentType?: string;  // e.g. 'image/jpeg'
}

/**
 * Upload a file buffer. Returns public URL.
 */
export async function uploadBlob(
  fileName: string,
  data: Buffer,
  options: UploadOptions = {}
): Promise<{ url: string; blobName: string; response: BlockBlobUploadResponse }> {
  const container = getContainer();
  const folder = options.folder ? `${options.folder.replace(/^\/|\/$/g, '')}/` : '';
  const blobName = `${folder}${Date.now()}-${fileName.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
  const blockBlob = container.getBlockBlobClient(blobName);

  const response = await blockBlob.upload(data, data.length, {
    blobHTTPHeaders: { blobContentType: options.contentType || 'application/octet-stream' },
  });

  return { url: blockBlob.url, blobName, response };
}

export async function deleteBlob(blobName: string): Promise<void> {
  const container = getContainer();
  await container.deleteBlob(blobName);
}

export async function getBlobUrl(blobName: string): Promise<string> {
  const container = getContainer();
  return container.getBlockBlobClient(blobName).url;
}
