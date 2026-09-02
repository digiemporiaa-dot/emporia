import "server-only";
import { r2Config } from "@/lib/config/env";
import { R2Storage, UnconfiguredStorage } from "@/lib/storage/r2";
import type { StorageService } from "@/lib/storage/types";

export type { ObjectHead, PresignedUpload, StorageService } from "@/lib/storage/types";

/**
 * The storage service for this deployment.
 *
 * Resolved lazily and cached, so `next build` does not need R2 credentials and
 * a deployment without them still boots — it just refuses uploads with a typed
 * error instead of pretending.
 */
let cached: StorageService | null = null;

export function storage(): StorageService {
  if (!cached) {
    const config = r2Config();
    cached = config ? new R2Storage(config) : new UnconfiguredStorage();
  }
  return cached;
}

export function isStorageConfigured(): boolean {
  return storage().configured;
}

/** Test seam: drop the memoised instance so a changed environment is re-read. */
export function resetStorage(): void {
  cached = null;
}
