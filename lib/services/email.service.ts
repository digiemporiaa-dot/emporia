import "server-only";
import { db } from "@/lib/db";
import { env } from "@/lib/config/env";
import { NotFoundError, ValidationError, isAppError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { record } from "@/lib/services/audit.service";
import { mailer } from "@/lib/email";
import { htmlToText, missingVariables, render } from "@/lib/email/render";
import { DEFAULT_TEMPLATES, GLOBAL_VARIABLES } from "@/lib/email/templates";
import { log } from "@/lib/logger";
import type { Actor } from "@/lib/actor/types";
import type { EmailStatus, EmailTemplateKey } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Sending email.
 *
 * Two rules carry this module.
 *
 * **Every send is logged.** An EmailLog row is written before the provider is
 * touched, and updated with the outcome — SENT with the provider's message id,
 * or FAILED with the reason. There is no path that sends without a row and none
 * that swallows a failure, so the admin log is a complete record rather than a
 * sample (the phase 12 exit criterion).
 *
 * **A failed send never fails the work.** Capturing a lead, sending a proposal
 * or inviting a client succeeds or fails on its own terms; the notification is
 * a consequence, not a precondition. `sendTemplate` therefore resolves with a
 * result rather than throwing, and the caller carries on.
 */

const emailLog = log("email");

export type SendOptions = {
  to: string;
  cc?: string | null;
  variables: Record<string, string>;
  /** What this email is about, so the log can be filtered by record. */
  entity?: { type: string; id: string } | null;
};

export type SendOutcome =
  | { ok: true; logId: string; messageId: string | null }
  | { ok: false; logId: string | null; error: string };

/** Site-wide values every template may use. */
async function globals(): Promise<Record<string, string>> {
  const setting = await db.siteSetting.findUnique({
    where: { key: "site.name" },
    select: { value: true },
  });

  const siteName =
    typeof setting?.value === "string" && setting.value.trim() ? setting.value : "Emporia";

  return { siteName, siteUrl: env().SITE_URL.replace(/\/$/, "") };
}

/**
 * Render and send one template.
 *
 * Never throws: the outcome is returned, and the log row is the record either
 * way.
 */
export async function sendTemplate(
  key: EmailTemplateKey,
  options: SendOptions,
): Promise<SendOutcome> {
  let logId: string | null = null;

  try {
    const template = await db.emailTemplate.findUnique({ where: { key } });

    if (!template) {
      return await fail(key, options, null, "That template does not exist. Run the seed.");
    }
    if (!template.isActive) {
      // Switched off deliberately, so this is not an error — but it is still
      // recorded, because "why did the client not get it?" needs an answer.
      const row = await db.emailLog.create({
        data: {
          templateKey: key,
          to: options.to,
          cc: options.cc ?? null,
          subject: template.subject,
          status: "FAILED",
          error: "That template is switched off.",
          // Kept even here, so switching the template back on and retrying
          // sends the message that was meant.
          variables: options.variables,
          entityType: options.entity?.type ?? null,
          entityId: options.entity?.id ?? null,
        },
        select: { id: true },
      });
      return { ok: false, logId: row.id, error: "That template is switched off." };
    }

    const variables = { ...(await globals()), ...options.variables };

    const subject = render(template.subject, variables, { escape: false });
    const html = render(template.html, variables);
    const text = template.text
      ? render(template.text, variables, { escape: false })
      : htmlToText(html);

    const row = await db.emailLog.create({
      data: {
        templateKey: key,
        to: options.to,
        cc: options.cc ?? null,
        subject,
        status: "QUEUED",
        // Kept so a retry re-renders the same message rather than one full of
        // unfilled placeholders.
        variables: options.variables,
        entityType: options.entity?.type ?? null,
        entityId: options.entity?.id ?? null,
      },
      select: { id: true },
    });
    logId = row.id;

    const result = await mailer().send({ to: options.to, cc: options.cc ?? null, subject, html, text });

    await db.emailLog.update({
      where: { id: row.id },
      data: { status: "SENT", sentAt: new Date(), providerMessageId: result.messageId },
    });

    emailLog.info({ key, to: options.to, logId: row.id }, "email sent");
    return { ok: true, logId: row.id, messageId: result.messageId };
  } catch (error) {
    const message = isAppError(error)
      ? error.message
      : error instanceof Error
        ? error.message
        : "The email could not be sent.";

    emailLog.warn({ err: error, key, to: options.to }, "email failed");

    if (logId) {
      await db.emailLog.update({
        where: { id: logId },
        data: { status: "FAILED", error: message.slice(0, 500) },
      });
      return { ok: false, logId, error: message };
    }

    return await fail(key, options, null, message);
  }
}

/** Record a failure that happened before a log row existed. */
async function fail(
  key: EmailTemplateKey,
  options: SendOptions,
  subject: string | null,
  error: string,
): Promise<SendOutcome> {
  try {
    const row = await db.emailLog.create({
      data: {
        templateKey: key,
        to: options.to,
        cc: options.cc ?? null,
        subject: subject ?? String(key),
        status: "FAILED",
        error: error.slice(0, 500),
        variables: options.variables,
        entityType: options.entity?.type ?? null,
        entityId: options.entity?.id ?? null,
      },
      select: { id: true },
    });
    return { ok: false, logId: row.id, error };
  } catch (cause) {
    // The database is unreachable, which the caller will discover anyway.
    emailLog.error({ err: cause, key }, "could not even log the failure");
    return { ok: false, logId: null, error };
  }
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export async function listTemplates(actor: Actor) {
  requirePermission(actor, "emails.view");

  const rows = await db.emailTemplate.findMany({ orderBy: { key: "asc" } });

  return rows.map((row) => ({
    ...row,
    variables: (row.variables ?? {}) as Record<string, string>,
  }));
}

export async function getTemplate(actor: Actor, key: EmailTemplateKey) {
  requirePermission(actor, "emails.view");

  const template = await db.emailTemplate.findUnique({ where: { key } });
  if (!template) throw new NotFoundError("That template does not exist.");

  return {
    ...template,
    variables: (template.variables ?? {}) as Record<string, string>,
    /** What the defaults look like, so an edit can be compared or reverted. */
    original: DEFAULT_TEMPLATES.find((t) => t.key === key) ?? null,
    globals: GLOBAL_VARIABLES,
  };
}

export type TemplateUpdate = {
  key: EmailTemplateKey;
  name: string;
  subject: string;
  html: string;
  text: string | null;
  isActive: boolean;
};

export async function updateTemplate(actor: Actor, input: TemplateUpdate) {
  requirePermission(actor, "emails.edit");

  const existing = await db.emailTemplate.findUnique({ where: { key: input.key } });
  if (!existing) throw new NotFoundError("That template does not exist.");

  const declared = (existing.variables ?? {}) as Record<string, string>;
  const known = new Set([...Object.keys(declared), ...Object.keys(GLOBAL_VARIABLES)]);

  // An edit that refers to a variable nothing supplies would send a mail with
  // "{{whatever}}" in it. Refuse rather than let that reach a client.
  const unknown = [
    ...new Set([
      ...unknownIn(input.subject, known),
      ...unknownIn(input.html, known),
      ...unknownIn(input.text ?? "", known),
    ]),
  ];

  if (unknown.length > 0) {
    throw new ValidationError(
      `Nothing supplies ${unknown.map((name) => `{{${name}}}`).join(", ")}. Use only the variables listed.`,
    );
  }

  const updated = await db.emailTemplate.update({
    where: { key: input.key },
    data: {
      name: input.name,
      subject: input.subject,
      html: input.html,
      text: input.text,
      isActive: input.isActive,
    },
    select: { key: true },
  });

  await record({
    actor,
    action: "UPDATE",
    entityType: "EmailTemplate",
    entityId: input.key,
    before: { subject: existing.subject, isActive: existing.isActive },
    after: { subject: input.subject, isActive: input.isActive },
  });

  return updated;
}

function unknownIn(template: string, known: Set<string>): string[] {
  return missingVariables(
    template,
    Object.fromEntries([...known].map((name) => [name, ""])),
  );
}

/**
 * Send a template to yourself with sample values, to see what it looks like.
 *
 * Sample values are clearly marked as such — they are not invented data
 * pretending to be a real lead.
 */
export async function sendTestEmail(actor: Actor, key: EmailTemplateKey, to: string) {
  requirePermission(actor, "emails.send");

  const template = await db.emailTemplate.findUnique({ where: { key } });
  if (!template) throw new NotFoundError("That template does not exist.");

  const declared = (template.variables ?? {}) as Record<string, string>;
  const samples = Object.fromEntries(
    Object.keys(declared).map((name) => [name, `[${name}]`]),
  );

  const outcome = await sendTemplate(key, {
    to,
    variables: samples,
    entity: { type: "EmailTemplate", id: key },
  });

  await record({ actor, action: "SEND", entityType: "EmailTemplate", entityId: key });
  return outcome;
}

// ---------------------------------------------------------------------------
// The log
// ---------------------------------------------------------------------------

export type EmailLogParams = {
  page?: number;
  perPage?: number;
  status?: EmailStatus | null;
  templateKey?: EmailTemplateKey | null;
  search?: string | null;
};

export async function listEmailLog(actor: Actor, params: EmailLogParams = {}) {
  requirePermission(actor, "emails.view");

  const page = Math.max(1, params.page ?? 1);
  const perPage = Math.min(100, Math.max(10, params.perPage ?? 50));
  const search = params.search?.trim();

  const where: Prisma.EmailLogWhereInput = {
    ...(params.status ? { status: params.status } : {}),
    ...(params.templateKey ? { templateKey: params.templateKey } : {}),
    ...(search
      ? {
          OR: [
            { to: { contains: search, mode: "insensitive" as const } },
            { subject: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [rows, total, failures] = await Promise.all([
    db.emailLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    db.emailLog.count({ where }),
    db.emailLog.count({ where: { status: "FAILED" } }),
  ]);

  return {
    rows,
    total,
    failures,
    page,
    perPage,
    pages: Math.max(1, Math.ceil(total / perPage)),
  };
}

/**
 * Try a failed send again.
 *
 * The original row is kept and a new one written, so the log stays a history of
 * what actually happened rather than being rewritten by the retry.
 */
export async function retryEmail(actor: Actor, logId: string) {
  requirePermission(actor, "emails.send");

  const original = await db.emailLog.findUnique({ where: { id: logId } });
  if (!original) throw new NotFoundError("That email does not exist.");
  if (original.status === "SENT") throw new ValidationError("That email was already sent.");
  if (!original.templateKey) {
    throw new ValidationError("That email has no template to resend from.");
  }

  // Re-rendered from the values the original was rendered with. Without them
  // a retry would deliver a mail full of "{{placeholders}}", which is worse
  // than not retrying at all.
  const variables = original.variables as Record<string, string> | null;
  if (!variables) {
    throw new ValidationError(
      "That email predates retry support, so it cannot be re-rendered. Send it again from where it came from.",
    );
  }

  const outcome = await sendTemplate(original.templateKey, {
    to: original.to,
    cc: original.cc,
    variables,
    entity:
      original.entityType && original.entityId
        ? { type: original.entityType, id: original.entityId }
        : null,
  });

  await record({ actor, action: "SEND", entityType: "EmailLog", entityId: logId });
  return outcome;
}
