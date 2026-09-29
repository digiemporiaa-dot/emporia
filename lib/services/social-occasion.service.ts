import "server-only";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { withAudit } from "@/lib/services/audit.service";
import { resolveClientScope } from "@/lib/social/scope";
import { slugify } from "@/lib/utils/slug";
import { isoDay, occasionSchema, type OccasionInput } from "@/lib/validation/social-occasion";
import type { OccasionCategory } from "@/generated/prisma/enums";
import type { Actor } from "@/lib/actor/types";

/**
 * The occasion library, and which occasions each client wants on its
 * calendar.
 *
 * Two kinds of ownership, checked differently:
 *
 * - **Library occasions** (`clientId` null) reach every client, so editing
 *   them needs `social.occasions.manage`.
 * - **A client's own occasions** (a brand anniversary) are that client's, so
 *   editing them needs `social.edit` and the client's scope — the same rule as
 *   pillars and campaigns.
 *
 * A library occasion appears on a client's calendar only if someone opted the
 * client in. A client's own occasions are always on for that client. Nothing
 * here creates or publishes content.
 */

const occasionSelect = {
  id: true,
  clientId: true,
  slug: true,
  name: true,
  category: true,
  description: true,
  fixedMonth: true,
  fixedDay: true,
  archivedAt: true,
  dates: { orderBy: { date: "asc" }, select: { id: true, date: true } },
} as const;

export type OccasionRow = {
  id: string;
  clientId: string | null;
  slug: string;
  name: string;
  category: OccasionCategory;
  description: string | null;
  fixedMonth: number | null;
  fixedDay: number | null;
  archivedAt: Date | null;
  dates: { id: string; date: Date }[];
};

/** One day an occasion falls on, as a calendar day rather than a moment. */
export type OccasionDay = {
  occasionId: string;
  name: string;
  category: OccasionCategory;
  /** `YYYY-MM-DD`. */
  day: string;
  own: boolean;
};

const ymd = (date: Date) => date.toISOString().slice(0, 10);

/**
 * The days an occasion falls on between two calendar days (inclusive).
 *
 * A fixed occasion recurs every year; a moving one only on the dates a person
 * entered. 29 February appears only in leap years.
 */
export function occurrences(
  occasion: Pick<OccasionRow, "fixedMonth" | "fixedDay" | "dates">,
  fromDay: string,
  toDay: string,
): string[] {
  const days: string[] = [];
  if (occasion.fixedMonth !== null && occasion.fixedDay !== null) {
    const fromYear = Number(fromDay.slice(0, 4));
    const toYear = Number(toDay.slice(0, 4));
    for (let year = fromYear; year <= toYear; year += 1) {
      const date = new Date(Date.UTC(year, occasion.fixedMonth - 1, occasion.fixedDay));
      // Rolled into the next month means the day does not exist this year.
      if (date.getUTCMonth() !== occasion.fixedMonth - 1) continue;
      const day = ymd(date);
      if (day >= fromDay && day <= toDay) days.push(day);
    }
  }
  for (const row of occasion.dates) {
    const day = ymd(row.date);
    if (day >= fromDay && day <= toDay && !days.includes(day)) days.push(day);
  }
  return days.sort();
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** The agency-wide library. Archived ones included, for the library screen. */
export async function listLibrary(actor: Actor): Promise<OccasionRow[]> {
  requirePermission(actor, "social.view");
  if (actor.type !== "STAFF") return [];
  return db.contentOccasion.findMany({
    where: { clientId: null },
    orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { fixedMonth: { sort: "asc", nulls: "last" } }, { fixedDay: "asc" }, { name: "asc" }],
    select: occasionSelect,
  });
}

/** Everything a client's occasions panel shows: the library with opt-in state, and the client's own. */
export async function clientOccasions(actor: Actor, clientId: string) {
  requirePermission(actor, "social.view");
  const scope = await resolveClientScope(actor, clientId);

  const [library, own, chosen] = await Promise.all([
    db.contentOccasion.findMany({
      where: { clientId: null, archivedAt: null },
      orderBy: [{ fixedMonth: { sort: "asc", nulls: "last" } }, { fixedDay: "asc" }, { name: "asc" }],
      select: occasionSelect,
    }),
    db.contentOccasion.findMany({
      where: { clientId: scope, archivedAt: null },
      orderBy: [{ fixedMonth: { sort: "asc", nulls: "last" } }, { fixedDay: "asc" }, { name: "asc" }],
      select: occasionSelect,
    }),
    db.clientOccasion.findMany({ where: { clientId: scope }, select: { occasionId: true } }),
  ]);
  const on = new Set(chosen.map((c) => c.occasionId));
  return {
    library: library.map((occasion) => ({ ...occasion, optedIn: on.has(occasion.id) })),
    own,
  };
}

/**
 * The client's occasions falling between two calendar days: library ones it
 * opted in to, and its own. What the calendar marks and the planner offers.
 */
export async function occasionsBetween(
  actor: Actor,
  clientId: string,
  fromDay: string,
  toDay: string,
): Promise<OccasionDay[]> {
  requirePermission(actor, "social.view");
  const scope = await resolveClientScope(actor, clientId);

  const rows = await db.contentOccasion.findMany({
    where: {
      archivedAt: null,
      OR: [{ clientId: scope }, { clientId: null, choices: { some: { clientId: scope } } }],
    },
    select: occasionSelect,
  });

  return rows
    .flatMap((occasion) =>
      occurrences(occasion, fromDay, toDay).map((day) => ({
        occasionId: occasion.id,
        name: occasion.name,
        category: occasion.category,
        day,
        own: occasion.clientId !== null,
      })),
    )
    .sort((a, b) => a.day.localeCompare(b.day) || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Whoever may change this occasion. Library → `social.occasions.manage`;
 * a client's own → `social.edit` within the client's scope.
 */
async function authorise(actor: Actor, clientId: string | null): Promise<string | null> {
  if (clientId === null) {
    requirePermission(actor, "social.occasions.manage");
    if (actor.type !== "STAFF") throw new NotFoundError("That occasion does not exist.");
    return null;
  }
  requirePermission(actor, "social.edit");
  return resolveClientScope(actor, clientId);
}

async function occasionFor(actor: Actor, id: string) {
  const occasion = await db.contentOccasion.findUnique({ where: { id }, select: occasionSelect });
  if (!occasion) throw new NotFoundError("That occasion does not exist.");
  await authorise(actor, occasion.clientId);
  return occasion;
}

async function uniqueSlug(name: string, clientId: string | null): Promise<string> {
  const base = slugify(clientId ? `${name}-${clientId.slice(-6)}` : name) || "occasion";
  let slug = base;
  for (let n = 2; await db.contentOccasion.findUnique({ where: { slug }, select: { id: true } }); n += 1) {
    slug = `${base}-${n}`;
  }
  return slug;
}

/** Create an occasion — in the library when `clientId` is null, otherwise the client's own. */
export async function createOccasion(actor: Actor, clientId: string | null, input: OccasionInput) {
  const scope = await authorise(actor, clientId);
  const data = occasionSchema.parse(input);

  const clash = await db.contentOccasion.findFirst({
    where: { clientId: scope, name: { equals: data.name, mode: "insensitive" }, archivedAt: null },
    select: { id: true },
  });
  if (clash) throw new ConflictError(`"${data.name}" is already ${scope ? "one of this client's occasions" : "in the library"}.`);

  const slug = await uniqueSlug(data.name, scope);
  return withAudit(
    { actor, action: "CREATE", entityType: "ContentOccasion", entityId: slug, after: { ...data, clientId: scope } },
    (tx) => tx.contentOccasion.create({ data: { ...data, clientId: scope, slug }, select: occasionSelect }),
  );
}

export async function updateOccasion(actor: Actor, id: string, input: OccasionInput) {
  const occasion = await occasionFor(actor, id);
  const data = occasionSchema.parse(input);
  const clash = await db.contentOccasion.findFirst({
    where: { id: { not: id }, clientId: occasion.clientId, name: { equals: data.name, mode: "insensitive" }, archivedAt: null },
    select: { id: true },
  });
  if (clash) throw new ConflictError(`"${data.name}" is already ${occasion.clientId ? "one of this client's occasions" : "in the library"}.`);
  return withAudit(
    {
      actor,
      action: "UPDATE",
      entityType: "ContentOccasion",
      entityId: id,
      before: {
        name: occasion.name,
        category: occasion.category,
        description: occasion.description,
        fixedMonth: occasion.fixedMonth,
        fixedDay: occasion.fixedDay,
      },
      after: data,
    },
    async (tx) => {
      // A day fixed every year makes the entered dates meaningless; keeping
      // them would mark the occasion twice.
      if (data.fixedMonth !== null) await tx.contentOccasionDate.deleteMany({ where: { occasionId: id } });
      return tx.contentOccasion.update({ where: { id }, data, select: occasionSelect });
    },
  );
}

export async function setOccasionArchived(actor: Actor, id: string, archived: boolean) {
  const occasion = await occasionFor(actor, id);
  return withAudit(
    {
      actor,
      action: "UPDATE",
      entityType: "ContentOccasion",
      entityId: id,
      before: { archived: occasion.archivedAt !== null },
      after: { archived },
    },
    (tx) =>
      tx.contentOccasion.update({
        where: { id },
        data: { archivedAt: archived ? new Date() : null },
        select: occasionSelect,
      }),
  );
}

/**
 * Record the date a moving occasion falls on in a given year. Entered by a
 * person who has checked it — never computed here.
 */
export async function addOccasionDate(actor: Actor, id: string, day: string) {
  const occasion = await occasionFor(actor, id);
  const parsed = isoDay.parse(day);
  if (occasion.fixedMonth !== null) {
    throw new ValidationError("This occasion falls on the same day every year; it needs no dates.");
  }
  const date = new Date(`${parsed}T00:00:00Z`);
  const year = date.getUTCFullYear();
  if (occasion.dates.some((d) => d.date.getUTCFullYear() === year && ymd(d.date) !== parsed)) {
    // Two Diwalis in one year is almost always a typo. A genuinely recurring
    // event can be added as separate occasions.
    throw new ConflictError(`${occasion.name} already has a date in ${year}. Remove it first to change it.`);
  }
  return withAudit(
    { actor, action: "UPDATE", entityType: "ContentOccasion", entityId: id, after: { addedDate: parsed } },
    (tx) =>
      tx.contentOccasionDate.upsert({
        where: { occasionId_date: { occasionId: id, date } },
        create: { occasionId: id, date },
        update: {},
        select: { id: true, date: true },
      }),
  );
}

export async function removeOccasionDate(actor: Actor, dateId: string) {
  const row = await db.contentOccasionDate.findUnique({
    where: { id: dateId },
    select: { id: true, date: true, occasionId: true },
  });
  if (!row) throw new NotFoundError("That date does not exist.");
  await occasionFor(actor, row.occasionId);
  await withAudit(
    { actor, action: "UPDATE", entityType: "ContentOccasion", entityId: row.occasionId, after: { removedDate: ymd(row.date) } },
    (tx) => tx.contentOccasionDate.delete({ where: { id: dateId } }),
  );
}

/** Opt a client in to (or out of) a library occasion. */
export async function setClientOccasion(actor: Actor, clientId: string, occasionId: string, optedIn: boolean) {
  requirePermission(actor, "social.edit");
  const scope = await resolveClientScope(actor, clientId);
  const occasion = await db.contentOccasion.findFirst({
    where: { id: occasionId, clientId: null, archivedAt: null },
    select: { id: true, name: true },
  });
  // Only library occasions are opted in to; a client's own are always on,
  // and another client's own occasion is not one this client can see.
  if (!occasion) throw new NotFoundError("That occasion is not in the library.");

  await withAudit(
    { actor, action: "UPDATE", entityType: "ClientOccasion", entityId: `${scope}:${occasionId}`, after: { occasion: occasion.name, optedIn } },
    async (tx) => {
      if (optedIn) {
        await tx.clientOccasion.upsert({
          where: { clientId_occasionId: { clientId: scope, occasionId } },
          create: { clientId: scope, occasionId },
          update: {},
        });
      } else {
        await tx.clientOccasion.deleteMany({ where: { clientId: scope, occasionId } });
      }
    },
  );
}
