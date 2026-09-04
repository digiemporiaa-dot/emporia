import "server-only";
import { db } from "@/lib/db";
import { record } from "@/lib/services/audit.service";
import { notify } from "@/lib/services/notification.service";
import { sendTemplate } from "@/lib/services/email.service";
import { nextProjectCode } from "@/lib/projects/numbering";
import { log } from "@/lib/logger";
import { systemActor } from "@/lib/actor/types";
import type { ActionConfig } from "@/lib/validation/automation";
import type { Facts, Subject } from "@/lib/automation/types";
import type { Actor } from "@/lib/actor/types";
import type { RoleName } from "@/generated/prisma/enums";

const ROLE_NAMES: readonly RoleName[] = [
  "SUPER_ADMIN",
  "ADMIN",
  "SALES_MANAGER",
  "SALES_EXECUTIVE",
  "MARKETING_MANAGER",
  "CONTENT_MANAGER",
  "PROJECT_MANAGER",
  "STAFF",
  "CLIENT_USER",
];

/**
 * What a rule can do.
 *
 * Every handler is idempotent-ish by design: it checks the world before acting,
 * so a rule that fires twice does not create two clients or reassign a lead
 * somebody has since taken over. Each one returns a short sentence describing
 * what it did — including "nothing, because…" — and that sentence is what the
 * admin sees in the run log.
 *
 * Every action that changes something writes its own AuditLog row under the
 * automation actor, which is the phase's exit criterion.
 */

const autoLog = log("automation");

export type ActionOutcome = {
  type: ActionConfig["type"];
  /** False when the action deliberately did nothing, or could not. */
  changed: boolean;
  detail: string;
};

/** The actor every automated write is attributed to. */
export function automationActor(): Actor {
  return { ...systemActor(), name: "Automation" };
}

/** `{{fact.key}}` substitution for the few configs that accept a template. */
function fill(template: string, facts: Facts): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => {
    const value = facts[key];
    return value === null || value === undefined ? "" : String(value);
  });
}

function inDays(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

export async function runAction(
  config: ActionConfig,
  subject: Subject,
  facts: Facts,
): Promise<ActionOutcome> {
  const actor = automationActor();

  switch (config.type) {
    case "ASSIGN_LEAD":
      return assignLead(config, subject, actor);
    case "CREATE_LEAD_TASK":
      return createLeadTask(config, subject, facts, actor);
    case "SEND_EMAIL":
      return sendEmail(config, subject, facts);
    case "NOTIFY_USER":
      return notifyUser(config, subject, facts);
    case "CREATE_CLIENT":
      return createClient(subject);
    case "CREATE_PROJECT":
      return createProject(config, subject, facts, actor);
    case "CREATE_PROJECT_TASKS":
      return createProjectTasks(config, subject, actor);
    case "SET_LEAD_STATUS":
      return setLeadStatus(config, subject, actor);
    case "ADD_TAG":
      return addTag(config, subject, actor);
  }
}

// ---------------------------------------------------------------------------

async function assignLead(
  config: Extract<ActionConfig, { type: "ASSIGN_LEAD" }>,
  subject: Subject,
  actor: Actor,
): Promise<ActionOutcome> {
  const type = "ASSIGN_LEAD" as const;
  if (!subject.leadId) return { type, changed: false, detail: "No lead to assign." };

  const lead = await db.lead.findUnique({
    where: { id: subject.leadId },
    select: { id: true, assignedToId: true },
  });
  if (!lead) return { type, changed: false, detail: "That lead no longer exists." };

  if (lead.assignedToId && config.onlyIfUnassigned) {
    return { type, changed: false, detail: "Already assigned; left alone." };
  }

  // Imported lazily: crm.service calls back into the engine to raise
  // LEAD_ASSIGNED, so a static import here would be a module cycle.
  const { pickAssignee } = await import("@/lib/services/crm.service");

  const userId =
    config.strategy === "SPECIFIC" ? (config.userId ?? null) : await pickAssignee();

  if (!userId) {
    return { type, changed: false, detail: "No one available to assign to." };
  }
  if (userId === lead.assignedToId) {
    return { type, changed: false, detail: "Already assigned to that person." };
  }

  const assignee = await db.user.findFirst({
    where: { id: userId, type: "STAFF", status: "ACTIVE" },
    select: { id: true, name: true },
  });
  if (!assignee) return { type, changed: false, detail: "That user is not an active staff member." };

  await db.$transaction(async (tx) => {
    await tx.lead.update({ where: { id: lead.id }, data: { assignedToId: assignee.id } });
    await tx.leadAssignment.create({
      data: {
        leadId: lead.id,
        toUserId: assignee.id,
        fromUserId: lead.assignedToId,
        // `assignedById` is a required FK and automation has no User row, so
        // the assignee stands as the assigner — the same convention
        // `assignOnCapture` uses for round-robin assignment.
        assignedById: assignee.id,
        reason: "Assigned by an automation.",
      },
    });
    await tx.leadActivity.create({
      data: {
        leadId: lead.id,
        type: "ASSIGNED",
        summary: `Assigned to ${assignee.name} by an automation.`,
        meta: { automated: true },
      },
    });
    await record(
      { actor, action: "ASSIGN", entityType: "Lead", entityId: lead.id, after: { assignedToId: assignee.id } },
      tx,
    );
  });

  return { type, changed: true, detail: `Assigned to ${assignee.name}.` };
}

async function createLeadTask(
  config: Extract<ActionConfig, { type: "CREATE_LEAD_TASK" }>,
  subject: Subject,
  facts: Facts,
  actor: Actor,
): Promise<ActionOutcome> {
  const type = "CREATE_LEAD_TASK" as const;
  if (!subject.leadId) return { type, changed: false, detail: "No lead to attach a task to." };

  const lead = await db.lead.findUnique({
    where: { id: subject.leadId },
    select: { id: true, assignedToId: true },
  });
  if (!lead) return { type, changed: false, detail: "That lead no longer exists." };

  const assigneeId =
    config.assignTo === "SPECIFIC" ? (config.userId ?? null) : lead.assignedToId;

  // LeadTask.assigneeId is required, so an unassigned lead genuinely cannot
  // carry a task. Saying so beats inventing an owner.
  if (!assigneeId) {
    return { type, changed: false, detail: "No owner for the task, so none was created." };
  }

  const task = await db.$transaction(async (tx) => {
    const created = await tx.leadTask.create({
      data: {
        leadId: lead.id,
        assigneeId,
        title: fill(config.title, facts),
        detail: config.detail ? fill(config.detail, facts) : null,
        dueAt: inDays(config.dueInDays),
        priority: config.priority,
      },
      select: { id: true, title: true },
    });
    await record(
      { actor, action: "CREATE", entityType: "LeadTask", entityId: created.id, after: { automated: true, leadId: lead.id } },
      tx,
    );
    return created;
  });

  return { type, changed: true, detail: `Created "${task.title}".` };
}

async function sendEmail(
  config: Extract<ActionConfig, { type: "SEND_EMAIL" }>,
  subject: Subject,
  facts: Facts,
): Promise<ActionOutcome> {
  const type = "SEND_EMAIL" as const;
  const to = await resolveEmail(config, subject);
  if (!to) return { type, changed: false, detail: "No address to send to." };

  // Every variable the chosen template might want, filled from the facts. The
  // email service logs the attempt either way, success or failure.
  const outcome = await sendTemplate(config.templateKey, {
    to,
    variables: {
      subject: config.subject ? fill(config.subject, facts) : "",
      body: config.body ? fill(config.body, facts) : "",
      clientName: String(facts["client.name"] ?? ""),
      leadName: String(facts["lead.name"] ?? facts["client.name"] ?? ""),
      actionLabel: "Open",
      actionUrl: "",
    },
  });

  return outcome.ok
    ? { type, changed: true, detail: `Emailed ${to}.` }
    : { type, changed: false, detail: `Email to ${to} did not go: ${outcome.error}.` };
}

async function resolveEmail(
  config: Extract<ActionConfig, { type: "SEND_EMAIL" }>,
  subject: Subject,
): Promise<string | null> {
  if (config.to === "SPECIFIC") return config.email ?? null;

  if (config.to === "LEAD" && subject.leadId) {
    const lead = await db.lead.findUnique({ where: { id: subject.leadId }, select: { email: true } });
    return lead?.email ?? null;
  }

  if (config.to === "LEAD_OWNER" && subject.leadId) {
    const lead = await db.lead.findUnique({
      where: { id: subject.leadId },
      select: { assignedTo: { select: { email: true } } },
    });
    return lead?.assignedTo?.email ?? null;
  }

  if (config.to === "CLIENT_PRIMARY" && subject.clientId) {
    const contact = await db.clientContact.findFirst({
      where: { clientId: subject.clientId, isPrimary: true },
      select: { email: true },
    });
    return contact?.email || null;
  }

  return null;
}

async function notifyUser(
  config: Extract<ActionConfig, { type: "NOTIFY_USER" }>,
  subject: Subject,
  facts: Facts,
): Promise<ActionOutcome> {
  const type = "NOTIFY_USER" as const;
  const userIds = await resolveRecipients(config, subject);

  if (userIds.length === 0) return { type, changed: false, detail: "Nobody to notify." };

  for (const userId of userIds) {
    await notify({
      userId,
      title: fill(config.title, facts),
      body: config.body ? fill(config.body, facts) : null,
      href: hrefFor(subject),
      entity: entityFor(subject),
    });
  }

  return { type, changed: true, detail: `Notified ${userIds.length} person(s).` };
}

async function resolveRecipients(
  config: Extract<ActionConfig, { type: "NOTIFY_USER" }>,
  subject: Subject,
): Promise<string[]> {
  if (config.to === "SPECIFIC") return config.userId ? [config.userId] : [];

  if (config.to === "LEAD_OWNER" && subject.leadId) {
    const lead = await db.lead.findUnique({
      where: { id: subject.leadId },
      select: { assignedToId: true },
    });
    return lead?.assignedToId ? [lead.assignedToId] : [];
  }

  if (config.to === "PROJECT_MANAGER" && subject.projectId) {
    const project = await db.project.findUnique({
      where: { id: subject.projectId },
      select: { managerId: true },
    });
    return project ? [project.managerId] : [];
  }

  if (config.to === "ROLE" && config.roleName) {
    // Narrowed against the enum: an unknown role name matches nobody rather
    // than reaching the query as an arbitrary string.
    if (!ROLE_NAMES.includes(config.roleName as RoleName)) return [];
    const users = await db.user.findMany({
      where: { type: "STAFF", status: "ACTIVE", role: { name: config.roleName as RoleName } },
      select: { id: true },
    });
    return users.map((user) => user.id);
  }

  return [];
}

function hrefFor(subject: Subject): string | null {
  if (subject.leadId) return `/admin/leads/${subject.leadId}`;
  if (subject.projectId) return `/admin/projects/${subject.projectId}`;
  if (subject.invoiceId) return `/admin/finance/invoices/${subject.invoiceId}`;
  if (subject.proposalId) return `/admin/sales/proposals/${subject.proposalId}`;
  return null;
}

function entityFor(subject: Subject): { type: string; id: string } | null {
  if (subject.leadId) return { type: "Lead", id: subject.leadId };
  if (subject.projectId) return { type: "Project", id: subject.projectId };
  if (subject.invoiceId) return { type: "Invoice", id: subject.invoiceId };
  if (subject.proposalId) return { type: "Proposal", id: subject.proposalId };
  return null;
}

/**
 * Creating the client is a transactional part of accepting a proposal, so by
 * the time a PROPOSAL_ACCEPTED rule runs the client already exists. This action
 * therefore reports that rather than making a second one — the alternative is a
 * duplicate client every time the rule fires.
 */
async function createClient(subject: Subject): Promise<ActionOutcome> {
  const type = "CREATE_CLIENT" as const;
  if (subject.clientId) {
    return { type, changed: false, detail: "The client already exists." };
  }
  return {
    type,
    changed: false,
    detail: "Nothing to convert: this trigger carries no client.",
  };
}

async function createProject(
  config: Extract<ActionConfig, { type: "CREATE_PROJECT" }>,
  subject: Subject,
  facts: Facts,
  actor: Actor,
): Promise<ActionOutcome> {
  const type = "CREATE_PROJECT" as const;
  if (!subject.clientId) return { type, changed: false, detail: "No client to open a project for." };

  const name = fill(config.nameTemplate, facts).trim() || "New project";

  // A rule that fires twice on the same proposal should not open two projects.
  const existing = subject.proposalId
    ? await db.project.findFirst({
        where: { clientId: subject.clientId, name },
        select: { id: true, code: true },
      })
    : null;
  if (existing) {
    return { type, changed: false, detail: `Project ${existing.code} already covers this.` };
  }

  const managerId = config.managerId ?? (await defaultManagerId());
  if (!managerId) {
    return { type, changed: false, detail: "No project manager available, so no project was opened." };
  }

  const project = await db.$transaction(async (tx) => {
    const code = await nextProjectCode(tx);
    const created = await tx.project.create({
      data: {
        code,
        name,
        clientId: subject.clientId as string,
        managerId,
        status: "PLANNING",
        startsAt: inDays(config.startInDays),
        dueAt: config.dueInDays ? inDays(config.dueInDays) : null,
      },
      select: { id: true, code: true },
    });
    await record(
      { actor, action: "CREATE", entityType: "Project", entityId: created.id, after: { automated: true, code: created.code } },
      tx,
    );
    return created;
  });

  // So a CREATE_PROJECT_TASKS action later in the same rule knows where to put
  // them without the admin having to name the project twice.
  subject.projectId = project.id;

  return { type, changed: true, detail: `Opened ${project.code}.` };
}

async function defaultManagerId(): Promise<string | null> {
  const manager = await db.user.findFirst({
    where: {
      type: "STAFF",
      status: "ACTIVE",
      role: { permissions: { some: { permission: { key: "projects.create" } } } },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return manager?.id ?? null;
}

async function createProjectTasks(
  config: Extract<ActionConfig, { type: "CREATE_PROJECT_TASKS" }>,
  subject: Subject,
  actor: Actor,
): Promise<ActionOutcome> {
  const type = "CREATE_PROJECT_TASKS" as const;
  if (!subject.projectId) {
    return { type, changed: false, detail: "No project to add tasks to." };
  }

  const project = await db.project.findUnique({
    where: { id: subject.projectId },
    select: { id: true, managerId: true, _count: { select: { tasks: true } } },
  });
  if (!project) return { type, changed: false, detail: "That project no longer exists." };

  // Onboarding tasks belong on a fresh project. Adding them to one already
  // being worked would duplicate a checklist someone is halfway through.
  if (project._count.tasks > 0) {
    return { type, changed: false, detail: "That project already has tasks." };
  }

  await db.$transaction(async (tx) => {
    await tx.projectTask.createMany({
      data: config.titles.map((title, index) => ({
        projectId: project.id,
        title,
        assigneeId: project.managerId,
        dueAt: inDays(config.dueInDays),
        order: index,
      })),
    });
    await record(
      { actor, action: "CREATE", entityType: "ProjectTask", entityId: project.id, after: { automated: true, count: config.titles.length } },
      tx,
    );
  });

  return { type, changed: true, detail: `Added ${config.titles.length} task(s).` };
}

async function setLeadStatus(
  config: Extract<ActionConfig, { type: "SET_LEAD_STATUS" }>,
  subject: Subject,
  actor: Actor,
): Promise<ActionOutcome> {
  const type = "SET_LEAD_STATUS" as const;
  if (!subject.leadId) return { type, changed: false, detail: "No lead to update." };

  const lead = await db.lead.findUnique({
    where: { id: subject.leadId },
    select: { id: true, status: true },
  });
  if (!lead) return { type, changed: false, detail: "That lead no longer exists." };
  if (lead.status === config.status) {
    return { type, changed: false, detail: `Already ${config.status.toLowerCase()}.` };
  }

  // WON creates a client through the sales flow, so an automation must not
  // reach it by the side door and leave a won lead with no client behind it.
  if (config.status === "WON" || lead.status === "WON") {
    return { type, changed: false, detail: "Winning a lead goes through accepting a proposal." };
  }

  await db.$transaction(async (tx) => {
    await tx.lead.update({ where: { id: lead.id }, data: { status: config.status } });
    await tx.leadActivity.create({
      data: {
        leadId: lead.id,
        type: "STATUS_CHANGED",
        summary: `Status changed to ${config.status} by an automation.`,
        meta: { from: lead.status, to: config.status, automated: true },
      },
    });
    await record(
      { actor, action: "STATUS_CHANGE", entityType: "Lead", entityId: lead.id, before: { status: lead.status }, after: { status: config.status } },
      tx,
    );
  });

  return { type, changed: true, detail: `Moved to ${config.status.toLowerCase()}.` };
}

async function addTag(
  config: Extract<ActionConfig, { type: "ADD_TAG" }>,
  subject: Subject,
  actor: Actor,
): Promise<ActionOutcome> {
  const type = "ADD_TAG" as const;
  if (!subject.leadId) return { type, changed: false, detail: "No lead to tag." };

  const slug =
    config.tagName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "tag";

  const tag = await db.tag.upsert({
    where: { slug },
    update: {},
    create: { name: config.tagName, slug },
    select: { id: true, name: true },
  });

  const existing = await db.leadTag.findUnique({
    where: { leadId_tagId: { leadId: subject.leadId, tagId: tag.id } },
    select: { tagId: true },
  });
  if (existing) return { type, changed: false, detail: `Already tagged ${tag.name}.` };

  await db.$transaction(async (tx) => {
    await tx.leadTag.create({ data: { leadId: subject.leadId as string, tagId: tag.id } });
    await record(
      { actor, action: "UPDATE", entityType: "Lead", entityId: subject.leadId as string, after: { tagged: tag.name, automated: true } },
      tx,
    );
  });

  autoLog.info({ leadId: subject.leadId, tag: tag.name }, "lead tagged by automation");
  return { type, changed: true, detail: `Tagged ${tag.name}.` };
}
