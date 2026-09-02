import "server-only";
import { createHash } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2Config } from "@/lib/config/env";
import { IntegrationNotConfiguredError } from "@/lib/errors";
import type { ObjectHead, PresignedUpload, StorageService } from "@/lib/storage/types";

/**
 * Cloudflare R2 over the S3 API.
 *
 * Credentials are read once, server-side, from lib/config/env — they are never
 * exposed to the browser, which only ever receives a presigned URL that expires
 * (CLAUDE.md 2 rule 6).
 */

const PRESIGN_TTL_SECONDS = 300;

export class R2Storage implements StorageService {
  readonly configured = true;

  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBase: string;

  constructor(config: NonNullable<ReturnType<typeof r2Config>>) {
    this.bucket = config.bucket;
    this.publicBase = config.publicUrl.replace(/\/$/, "");

    this.client = new S3Client({
      region: "auto",
      // R2's S3 endpoint. Overridable so a jurisdiction-specific endpoint — or
      // a local S3-compatible server during verification — can be used without
      // code changes.
      endpoint: config.endpoint ?? `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: Boolean(config.endpoint),
    });
  }

  async presignUpload(input: {
    key: string;
    contentType: string;
    size: number;
  }): Promise<PresignedUpload> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
      ContentType: input.contentType,
      // Signed in, so the URL cannot be reused to upload something larger.
      ContentLength: input.size,
    });

    const url = await getSignedUrl(this.client, command, { expiresIn: PRESIGN_TTL_SECONDS });

    return {
      url,
      headers: {
        "content-type": input.contentType,
        "content-length": String(input.size),
      },
      expiresIn: PRESIGN_TTL_SECONDS,
    };
  }

  async head(key: string): Promise<ObjectHead | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );

      return {
        size: Number(result.ContentLength ?? 0),
        contentType: result.ContentType ?? null,
        checksum: result.ETag ? result.ETag.replaceAll('"', "") : null,
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async readRange(key: string, bytes: number): Promise<Uint8Array | null> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Range: `bytes=0-${Math.max(0, bytes - 1)}`,
        }),
      );

      const body = result.Body;
      if (!body) return null;

      // The SDK's stream helper, present on every runtime we target.
      const array = await body.transformToByteArray();
      return array;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  publicUrl(key: string): string {
    return `${this.publicBase}/${key}`;
  }
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = (error as { name?: string }).name;
  const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return name === "NotFound" || name === "NoSuchKey" || status === 404;
}

/**
 * Storage with no provider behind it.
 *
 * Every call throws rather than pretending an upload happened: a media library
 * that silently accepts files into nowhere is worse than one that refuses
 * (CLAUDE.md 2 rule 5).
 */
export class UnconfiguredStorage implements StorageService {
  readonly configured = false;

  private fail(): never {
    throw new IntegrationNotConfiguredError(
      "File storage is not configured. Set the R2_* environment variables.",
    );
  }

  async presignUpload(): Promise<PresignedUpload> {
    this.fail();
  }

  async head(): Promise<ObjectHead | null> {
    this.fail();
  }

  async readRange(): Promise<Uint8Array | null> {
    this.fail();
  }

  async delete(): Promise<void> {
    this.fail();
  }

  publicUrl(key: string): string {
    // Deliberately not a fake CDN URL: a caller that reaches this has a Media
    // row whose object was never stored anywhere reachable.
    return `about:blank#${createHash("sha256").update(key).digest("hex").slice(0, 8)}`;
  }
}
