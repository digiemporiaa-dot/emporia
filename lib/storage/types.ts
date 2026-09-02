/**
 * Storage provider contract.
 *
 * The product stores objects in Cloudflare R2, but nothing above this file
 * knows that: the service takes a key and hands back a presigned URL. Swapping
 * provider means writing one more implementation, not touching the media
 * service (CLAUDE.md 3).
 */

export type PresignedUpload = {
  /** Where the browser PUTs the bytes. Expires. */
  url: string;
  /** Headers the browser must send for the signature to match. */
  headers: Record<string, string>;
  /** Seconds until the URL stops working. */
  expiresIn: number;
};

export type ObjectHead = {
  size: number;
  contentType: string | null;
  checksum: string | null;
};

export interface StorageService {
  /** Whether a provider is actually configured. */
  readonly configured: boolean;

  /**
   * A URL the browser may PUT one object to, for one content type and one
   * exact size. The size is signed in, so a client that presigns a 2 MB image
   * cannot then upload 2 GB.
   */
  presignUpload(input: {
    key: string;
    contentType: string;
    size: number;
  }): Promise<PresignedUpload>;

  /** What the bucket actually holds at that key, or null if nothing does. */
  head(key: string): Promise<ObjectHead | null>;

  /**
   * The first `bytes` bytes of an object, for content sniffing. Ranged so a
   * 200 MB video costs a few kilobytes to verify.
   */
  readRange(key: string, bytes: number): Promise<Uint8Array | null>;

  delete(key: string): Promise<void>;

  /** The public URL for an object, derived from the configured public base. */
  publicUrl(key: string): string;
}
