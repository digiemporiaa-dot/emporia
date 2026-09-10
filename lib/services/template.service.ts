import "server-only";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { record, withAudit } from "@/lib/services/audit.service";
import { BLOCK_SCHEMAS, isBlockType, blockDefinition } from "@/lib/content/blocks";
import { stampVersion } from "@/lib/content/migrations";
import type { Actor } from "@/lib/actor/types";
import type { InputJsonValue } from "@/generated/prisma/internal/prismaNamespace";
import type { TemplateInput } from "@/lib/validation/template";

/**
 * Page templates.
 *
 * A template answers three questions the builder left open: which bands a page
 * of this kind starts with, which bands it may contain at all, and what its SEO
 * defaults to. A service landing page and a legal page are not the same object
 * with different words in them.
 *
 * ## Applied once, then let go
 *
 * A template is used at creation and the page owns its sections from that
 * moment. Editing a template never reaches back into pages already made from
 * it. That is deliberate: propagating would be a second, invisible way to
 * change a live page, and the builder should be the only way there is. The
 * `templateId` is kept for one purpose only — answering "which bands may this
 * page have".
 *
 * ## The restriction is enforced in the service, not the picker
 *
 * `allowedBlocks` gates `addSection` server-side. Filtering the Add Section
 * list is a courtesy; hiding a button is not authorization (CLAUDE.md 2 rule 2),
 * and the same rule applies to a content rule an editor could otherwise post
 * their way around.
 */

const templateSelect = {
  id: true,
  key: true,
  name: true,
  description: true,
  sections: true,
  allowedBlocks: true,
  defaultSchemaType: true,
  defaultRobotsIndex: true,
  isActive: true,
  order: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { pages: true } },
} as const;

/**
 * Validate a template's starting bands.
 *
 * Each entry is parsed against its own block schema and stored parsed, so a
 * template can never hold a shape the renderer has not agreed to — the same
 * rule `parseBlockContent` applies to a section. An entry with no content of
 * its own starts from the block's library defaults, which is the common case:
 * "start with a hero and an FAQ" rarely dictates the words.
 */
function parseSections(sections: TemplateInput["sections"]): InputJsonValue {
  return sections.map((section) => {
    if (!isBlockType(section.type)) {
      throw new ValidationError(`"${section.type}" is not a block you can add.`);
    }

    const raw = section.content ?? blockDefinition(section.type).defaults;
    const result = BLOCK_SCHEMAS[section.type].safeParse(raw);
    if (!result.success) {
      throw new ValidationError(
        `${section.type}: ${result.error.issues[0]?.message ?? "invalid content"}`,
      );
    }

    return { type: section.type, content: stampVersion(result.data) };
  }) as InputJsonValue;
}

export async function listTemplates(actor: Actor, includeInactive = false) {
  requirePermission(actor, "pages.view");

  return db.pageTemplate.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [{ order: "asc" }, { name: "asc" }],
    select: templateSelect,
  });
}

export async function getTemplate(actor: Actor, id: string) {
  requirePermission(actor, "pages.view");

  const template = await db.pageTemplate.findUnique({ where: { id }, select: templateSelect });
  if (!template) throw new NotFoundError("That template does not exist.");
  return template;
}

export async function createTemplate(actor: Actor, input: TemplateInput) {
  // Templates decide what pages may contain, which is closer to publishing than
  // to editing one page. `pages.publish` rather than `pages.create`.
  requirePermission(actor, "pages.publish");

  const clash = await db.pageTemplate.findUnique({
    where: { key: input.key },
    select: { id: true },
  });
  if (clash) throw new ConflictError("A template already uses that handle.");

  const sections = parseSections(input.sections);

  const template = await db.$transaction(async (tx) => {
    const created = await tx.pageTemplate.create({
      data: {
        key: input.key,
        name: input.name,
        description: input.description ?? null,
        sections,
        allowedBlocks: input.allowedBlocks as InputJsonValue,
        defaultSchemaType: input.defaultSchemaType,
        defaultRobotsIndex: input.defaultRobotsIndex,
        isActive: input.isActive,
        order: input.order,
      },
    });
    await record(
      { actor, action: "CREATE", entityType: "PageTemplate", entityId: created.id, after: created },
      tx,
    );
    return created;
  });

  return template;
}

export async function updateTemplate(actor: Actor, id: string, input: TemplateInput) {
  requirePermission(actor, "pages.publish");

  const before = await db.pageTemplate.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("That template does not exist.");

  const clash = await db.pageTemplate.findFirst({
    where: { key: input.key, id: { not: id } },
    select: { id: true },
  });
  if (clash) throw new ConflictError("Another template already uses that handle.");

  const sections = parseSections(input.sections);

  return withAudit(
    { actor, action: "UPDATE", entityType: "PageTemplate", entityId: id, before },
    (tx) =>
      tx.pageTemplate.update({
        where: { id },
        data: {
          key: input.key,
          name: input.name,
          description: input.description ?? null,
          sections,
          allowedBlocks: input.allowedBlocks as InputJsonValue,
          defaultSchemaType: input.defaultSchemaType,
          defaultRobotsIndex: input.defaultRobotsIndex,
          isActive: input.isActive,
          order: input.order,
        },
      }),
  );
}

/**
 * Delete a template.
 *
 * Refused while pages point at it, because their `templateId` is what answers
 * "which bands may this page have" — dropping it would quietly lift the
 * restriction on every page made from it. Switching the template off removes it
 * from the New page list without touching them.
 */
export async function deleteTemplate(actor: Actor, id: string) {
  requirePermission(actor, "pages.publish");

  const before = await db.pageTemplate.findUnique({
    where: { id },
    select: { id: true, key: true, name: true, _count: { select: { pages: true } } },
  });
  if (!before) throw new NotFoundError("That template does not exist.");

  if (before._count.pages > 0) {
    throw new ConflictError(
      `${before._count.pages} page${before._count.pages === 1 ? " uses" : "s use"} this template. Switch it off instead — deleting it would lift its block restriction on all of them.`,
    );
  }

  return withAudit(
    { actor, action: "DELETE", entityType: "PageTemplate", entityId: id, before },
    (tx) => tx.pageTemplate.delete({ where: { id }, select: { id: true } }),
  );
}
