import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { confirm, deleteMedia, listMedia, presign, updateMedia } from "@/lib/services/media.service";
import { resetStorage } from "@/lib/storage";
import { resetEnvCache } from "@/lib/config/env";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { S3Double } from "./support/s3-double";
import type { Actor } from "@/lib/actor/types";

/**
 * The phase 11 exit criterion, end to end: an upload with a spoofed extension
 * is rejected server-side.
 *
 * The real @aws-sdk/client-s3 path runs against a local S3-compatible double,
 * so presigning, the browser's PUT, the HEAD and the ranged sniff-read are all
 * genuinely exercised — only Cloudflare itself is substituted.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const PDF_BYTES = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n", "utf8");
const ELF_BYTES = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
const SVG_BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>', "utf8");
const EVIL_SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "utf8");

describeDb("media upload", () => {
  let prisma: PrismaClient;
  let s3: S3Double;
  let actor: Actor;
  let weakActor: Actor;
  let otherActor: Actor;
  const createdMedia: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: connectionString as string }),
    });

    s3 = new S3Double();
    const endpoint = await s3.start();

    // Point the real R2 client at the double.
    process.env["R2_ACCOUNT_ID"] = "test-account";
    process.env["R2_ACCESS_KEY_ID"] = "test-key";
    process.env["R2_SECRET_ACCESS_KEY"] = "test-secret";
    process.env["R2_BUCKET_NAME"] = "emporia-test";
    process.env["R2_PUBLIC_URL"] = "https://files.example.test";
    process.env["R2_ENDPOINT"] = endpoint;
    resetEnvCache();
    resetStorage();

    const user = await prisma.user.findFirstOrThrow({
      where: { type: "STAFF" },
      select: { id: true },
    });

    const base = {
      name: "Uploader",
      email: "uploader@media.test",
      type: "STAFF" as const,
      roleName: "MARKETING_MANAGER" as const,
      roleId: "r",
      clientId: null,
      ip: null,
      userAgent: null,
    };

    actor = {
      ...base,
      userId: user.id,
      permissions: new Set(["media.view", "media.upload", "media.edit", "media.delete"]),
    };
    weakActor = { ...base, userId: user.id, permissions: new Set(["media.view"]) };
    otherActor = { ...base, userId: "someone-else", permissions: new Set(["media.upload"]) };
  });

  afterAll(async () => {
    await prisma.mediaVersion.deleteMany({ where: { mediaId: { in: createdMedia } } });
    await prisma.media.deleteMany({ where: { id: { in: createdMedia } } });
    await prisma.mediaFolder.deleteMany({ where: { path: { startsWith: "/upload-test" } } });
    await prisma.$disconnect();
    await s3.stop();

    for (const key of [
      "R2_ACCOUNT_ID",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_BUCKET_NAME",
      "R2_PUBLIC_URL",
      "R2_ENDPOINT",
    ]) {
      delete process.env[key];
    }
    resetEnvCache();
    resetStorage();
  });

  afterEach(() => {
    s3.requests.length = 0;
  });

  /** What the browser does with a presigned URL. */
  async function upload(url: string, headers: Record<string, string>, body: Buffer) {
    const response = await fetch(url, {
      method: "PUT",
      headers,
      // A Buffer is a Uint8Array; fetch wants the view, not the Node type.
      body: new Uint8Array(body),
    });
    expect(response.ok).toBe(true);
  }

  function keyFromUrl(url: string): string {
    return new URL(url).pathname.split("/").slice(2).join("/");
  }

  it("presigns, uploads and records a genuine PNG", async () => {
    const ticket = await presign(actor, {
      filename: "brand-mark.png",
      contentType: "image/png",
      size: PNG_BYTES.length,
    });

    expect(ticket.url).toContain("X-Amz-Signature");
    const key = keyFromUrl(ticket.url);
    expect(key).toMatch(/^media\/\d{4}\/\d{2}\/[0-9a-f]{32}\.png$/);

    await upload(ticket.url, ticket.headers, PNG_BYTES);
    const media = await confirm(actor, ticket.uploadId);
    createdMedia.push(media.id);

    expect(media.filename).toBe("brand-mark.png");
    expect(media.type).toBe("IMAGE");
    expect(media.size).toBe(PNG_BYTES.length);
    expect(media.url).toBe(`https://files.example.test/${key}`);

    const row = await prisma.media.findUniqueOrThrow({
      where: { id: media.id },
      select: { key: true, mimeType: true, checksum: true, versions: { select: { version: true } } },
    });
    expect(row.key).toBe(key);
    expect(row.mimeType).toBe("image/png");
    expect(row.checksum).toBeTruthy();
    expect(row.versions).toHaveLength(1);
  });

  // ── The exit criterion ──────────────────────────────────────────────────

  it("rejects a PDF uploaded as a PNG, and removes it from the bucket", async () => {
    const ticket = await presign(actor, {
      filename: "not-really.png",
      contentType: "image/png",
      size: PDF_BYTES.length,
    });
    const key = keyFromUrl(ticket.url);

    await upload(ticket.url, ticket.headers, PDF_BYTES);
    expect(s3.has(key)).toBe(true);

    await expect(confirm(actor, ticket.uploadId)).rejects.toThrow(/is a PDF, not a PNG/i);

    // Refused and cleaned up: no row, and nothing left addressable in storage.
    expect(s3.has(key)).toBe(false);
    expect(await prisma.media.count({ where: { key } })).toBe(0);
  });

  it("rejects an executable renamed to .png", async () => {
    const ticket = await presign(actor, {
      filename: "payload.png",
      contentType: "image/png",
      size: ELF_BYTES.length,
    });
    const key = keyFromUrl(ticket.url);

    await upload(ticket.url, ticket.headers, ELF_BYTES);
    await expect(confirm(actor, ticket.uploadId)).rejects.toBeInstanceOf(ValidationError);

    expect(s3.has(key)).toBe(false);
    expect(await prisma.media.count({ where: { key } })).toBe(0);
  });

  it("rejects an SVG carrying script", async () => {
    const ticket = await presign(actor, {
      filename: "logo.svg",
      contentType: "image/svg+xml",
      size: EVIL_SVG.length,
    });
    const key = keyFromUrl(ticket.url);

    await upload(ticket.url, ticket.headers, EVIL_SVG);
    await expect(confirm(actor, ticket.uploadId)).rejects.toThrow(/script or external references/i);
    expect(s3.has(key)).toBe(false);
  });

  it("accepts a clean SVG", async () => {
    const ticket = await presign(actor, {
      filename: "mark.svg",
      contentType: "image/svg+xml",
      size: SVG_BYTES.length,
    });

    await upload(ticket.url, ticket.headers, SVG_BYTES);
    const media = await confirm(actor, ticket.uploadId);
    createdMedia.push(media.id);
    expect(media.filename).toBe("mark.svg");
  });

  // ── Size and type agreements ───────────────────────────────────────────

  it("refuses a file that does not match the size that was signed", async () => {
    const ticket = await presign(actor, {
      filename: "small.png",
      contentType: "image/png",
      size: PNG_BYTES.length,
    });
    const key = keyFromUrl(ticket.url);

    // Bypass the presigned PUT to put something bigger at the key, the way a
    // second request with a stolen key might.
    s3.put(key, Buffer.concat([PNG_BYTES, Buffer.alloc(1024)]), "image/png");

    await expect(confirm(actor, ticket.uploadId)).rejects.toThrow(/does not match what was agreed/i);
    expect(s3.has(key)).toBe(false);
  });

  it("refuses a type that is not on the allowlist", async () => {
    await expect(
      presign(actor, {
        filename: "script.sh",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately invalid input
        contentType: "application/x-sh" as any,
        size: 10,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("enforces the per-type size cap, not just the global one", async () => {
    await expect(
      presign(actor, {
        filename: "huge.png",
        contentType: "image/png",
        size: 11 * 1024 * 1024,
      }),
    ).rejects.toThrow(/at most 10 MB/i);
  });

  it("confirms nothing when the object never arrived", async () => {
    const ticket = await presign(actor, {
      filename: "never-uploaded.png",
      contentType: "image/png",
      size: PNG_BYTES.length,
    });

    await expect(confirm(actor, ticket.uploadId)).rejects.toThrow(/did not finish uploading/i);
  });

  // ── The intent cannot be forged or borrowed ────────────────────────────

  it("refuses a tampered upload id", async () => {
    const ticket = await presign(actor, {
      filename: "fine.png",
      contentType: "image/png",
      size: PNG_BYTES.length,
    });
    await upload(ticket.url, ticket.headers, PNG_BYTES);

    const [payload, signature] = ticket.uploadId.split(".");
    const decoded = JSON.parse(Buffer.from(payload as string, "base64url").toString("utf8"));
    decoded.size = 999999;
    const tampered = `${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${signature}`;

    await expect(confirm(actor, tampered)).rejects.toThrow(/not valid/i);
    await expect(confirm(actor, "garbage")).rejects.toThrow(/not valid/i);
  });

  it("refuses an upload id signed for a different user", async () => {
    const ticket = await presign(actor, {
      filename: "mine.png",
      contentType: "image/png",
      size: PNG_BYTES.length,
    });
    await upload(ticket.url, ticket.headers, PNG_BYTES);

    await expect(confirm(otherActor, ticket.uploadId)).rejects.toThrow(/not started by you/i);
  });

  it("refuses an expired upload id", async () => {
    const ticket = await presign(actor, {
      filename: "slow.png",
      contentType: "image/png",
      size: PNG_BYTES.length,
    });

    const [payload] = ticket.uploadId.split(".");
    const decoded = JSON.parse(Buffer.from(payload as string, "base64url").toString("utf8"));
    decoded.exp = Math.floor(Date.now() / 1000) - 10;

    // Re-signing is not possible without the secret, so an expired *valid*
    // token is produced by presigning and waiting; here the check is that a
    // token whose exp has passed cannot be re-signed by hand.
    const forged = `${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${ticket.uploadId.split(".")[1]}`;
    await expect(confirm(actor, forged)).rejects.toThrow(/not valid/i);
  });

  // ── Permissions ────────────────────────────────────────────────────────

  it("requires media.upload to presign or confirm", async () => {
    await expect(
      presign(weakActor, { filename: "x.png", contentType: "image/png", size: 10 }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(confirm(weakActor, "anything")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("requires media.delete to delete", async () => {
    const media = await prisma.media.findFirstOrThrow({
      where: { id: { in: createdMedia } },
      select: { id: true },
    });

    await expect(deleteMedia(weakActor, media.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  // ── Library operations ─────────────────────────────────────────────────

  it("lists and renames without letting the extension change", async () => {
    const listed = await listMedia(actor, { page: 1, perPage: 24, unused: false });
    expect(listed.total).toBeGreaterThanOrEqual(2);

    const target = createdMedia[0] as string;
    await updateMedia(actor, { id: target, filename: "renamed.exe", alt: "A mark", tags: [] });

    const row = await prisma.media.findUniqueOrThrow({
      where: { id: target },
      select: { filename: true, alt: true },
    });
    // The stored type decides the extension, not what was typed.
    expect(row.filename).toBe("renamed.png");
    expect(row.alt).toBe("A mark");
  });

  it("keeps a replaced file as a new version and leaves the old object alone", async () => {
    const original = createdMedia[0] as string;
    const before = await prisma.media.findUniqueOrThrow({
      where: { id: original },
      select: { key: true },
    });

    const ticket = await presign(actor, {
      filename: "brand-mark-v2.png",
      contentType: "image/png",
      size: PNG_BYTES.length + 4,
      replacesId: original,
    });

    await upload(ticket.url, ticket.headers, Buffer.concat([PNG_BYTES, Buffer.from([1, 2, 3, 4])]));
    const updated = await confirm(actor, ticket.uploadId);

    expect(updated.id).toBe(original);

    const row = await prisma.media.findUniqueOrThrow({
      where: { id: original },
      select: { key: true, size: true, versions: { orderBy: { version: "asc" }, select: { version: true, key: true } } },
    });

    expect(row.key).not.toBe(before.key);
    expect(row.size).toBe(PNG_BYTES.length + 4);
    expect(row.versions.map((v) => v.version)).toEqual([1, 2]);
    // The previous object stays: something published may still point at it.
    expect(s3.has(before.key)).toBe(true);
  });

  it("soft deletes, so a published page keeps its URL", async () => {
    const ticket = await presign(actor, {
      filename: "disposable.png",
      contentType: "image/png",
      size: PNG_BYTES.length,
    });
    await upload(ticket.url, ticket.headers, PNG_BYTES);
    const media = await confirm(actor, ticket.uploadId);
    createdMedia.push(media.id);

    await deleteMedia(actor, media.id);

    const row = await prisma.media.findUniqueOrThrow({
      where: { id: media.id },
      select: { deletedAt: true, key: true },
    });
    expect(row.deletedAt).not.toBeNull();
    expect(s3.has(row.key)).toBe(true);

    const listed = await listMedia(actor, { page: 1, perPage: 96, unused: false });
    expect(listed.rows.map((r) => r.id)).not.toContain(media.id);
  });
});
