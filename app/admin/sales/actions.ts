"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/actor";
import * as sales from "@/lib/services/sales.service";
import {
  acceptProposalSchema,
  catalogItemSchema,
  contractSchema,
  opportunitySchema,
  proposalSchema,
} from "@/lib/validation/sales";
import { toActionFailure, type ActionResult } from "@/lib/errors";
import { log } from "@/lib/logger";
import type { ProposalStatus } from "@/generated/prisma/enums";

const actionLog = log("sales");

export type SalesActionState = ActionResult<{ id: string }> | null;

function refresh(id?: string) {
  revalidatePath("/admin/sales");
  revalidatePath("/admin/sales/proposals");
  revalidatePath("/admin/sales/contracts");
  revalidatePath("/admin/clients");
  if (id) revalidatePath(`/admin/sales/proposals/${id}`);
}

/** Line items travel as JSON so their order and rates survive intact. */
function parseItems(value: FormDataEntryValue | null): unknown {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveProposalAction(
  _prev: SalesActionState,
  formData: FormData,
): Promise<SalesActionState> {
  try {
    const actor = await requireActor();
    const raw = Object.fromEntries(formData.entries());

    const parsed = proposalSchema.safeParse({
      ...raw,
      leadId: raw["leadId"] || null,
      clientId: raw["clientId"] || null,
      opportunityId: raw["opportunityId"] || null,
      validUntil: raw["validUntil"] === "" ? null : raw["validUntil"],
      items: parseItems(formData.get("items")),
    });

    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check the form.",
        details: parsed.error.flatten().fieldErrors,
      };
    }

    const id = typeof raw["id"] === "string" && raw["id"] ? raw["id"] : null;
    const proposal = id
      ? await sales.updateProposal(actor, id, parsed.data)
      : await sales.createProposal(actor, parsed.data);

    refresh(proposal.id);
    return { ok: true, data: { id: proposal.id } };
  } catch (error) {
    actionLog.warn({ err: error }, "saveProposal refused or failed");
    return toActionFailure(error);
  }
}

export async function sendProposalAction(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    await sales.sendProposal(actor, id);
    refresh(id);
    return { ok: true, data: { id } };
  } catch (error) {
    actionLog.warn({ err: error }, "sendProposal refused");
    return toActionFailure(error);
  }
}

export async function reviseProposalAction(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    await sales.reviseProposal(actor, id);
    refresh(id);
    return { ok: true, data: { id } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function setProposalStatusAction(
  id: string,
  status: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    await sales.setProposalStatus(actor, id, status as ProposalStatus);
    refresh(id);
    return { ok: true, data: { id } };
  } catch (error) {
    return toActionFailure(error);
  }
}

/**
 * Accept. Kept distinct from a plain status change because it creates a
 * Client — a consequence worth an explicit action rather than a dropdown.
 */
export async function acceptProposalAction(
  _prev: SalesActionState,
  formData: FormData,
): Promise<SalesActionState> {
  try {
    const actor = await requireActor();
    const parsed = acceptProposalSchema.safeParse({
      proposalId: formData.get("proposalId"),
      clientName: formData.get("clientName") || undefined,
    });

    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: "Check the form." };
    }

    const result = await sales.acceptProposal(actor, parsed.data.proposalId, {
      ...(parsed.data.clientName ? { clientName: parsed.data.clientName } : {}),
    });

    refresh(parsed.data.proposalId);
    return { ok: true, data: { id: result.clientId } };
  } catch (error) {
    actionLog.warn({ err: error }, "acceptProposal refused");
    return toActionFailure(error);
  }
}

export async function createContractFromProposalAction(
  proposalId: string,
  startsAt: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const contract = await sales.contractFromProposal(actor, proposalId, new Date(startsAt));
    refresh(proposalId);
    return { ok: true, data: { id: contract.id } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function saveOpportunityAction(
  _prev: SalesActionState,
  formData: FormData,
): Promise<SalesActionState> {
  try {
    const actor = await requireActor();
    const raw = Object.fromEntries(formData.entries());

    const parsed = opportunitySchema.safeParse({
      ...raw,
      leadId: raw["leadId"] || null,
      clientId: raw["clientId"] || null,
      expectedCloseAt: raw["expectedCloseAt"] === "" ? null : raw["expectedCloseAt"],
    });

    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Check the form." };
    }

    const id = typeof raw["id"] === "string" && raw["id"] ? raw["id"] : null;
    const opportunity = id
      ? await sales.updateOpportunity(actor, id, parsed.data)
      : await sales.createOpportunity(actor, parsed.data);

    revalidatePath("/admin/sales/opportunities");
    return { ok: true, data: { id: opportunity.id } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function markSignedAction(id: string, signedAt: string): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    await sales.markContractSigned(actor, id, new Date(signedAt));
    refresh();
    return { ok: true, data: { id } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function saveContractAction(
  _prev: SalesActionState,
  formData: FormData,
): Promise<SalesActionState> {
  try {
    const actor = await requireActor();
    const raw = Object.fromEntries(formData.entries());

    const parsed = contractSchema.safeParse({
      ...raw,
      proposalId: raw["proposalId"] || null,
      endsAt: raw["endsAt"] === "" ? null : raw["endsAt"],
      renewalAt: raw["renewalAt"] === "" ? null : raw["renewalAt"],
      terms: raw["terms"] || null,
    });

    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Check the form." };
    }

    const contract = await sales.createContract(actor, parsed.data);
    refresh();
    return { ok: true, data: { id: contract.id } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function saveCatalogItemAction(
  _prev: SalesActionState,
  formData: FormData,
): Promise<SalesActionState> {
  try {
    const actor = await requireActor();
    const raw = Object.fromEntries(formData.entries());

    const parsed = catalogItemSchema.safeParse({
      ...raw,
      description: raw["description"] || null,
      serviceId: raw["serviceId"] || null,
      isActive: formData.get("isActive") === "on",
    });

    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check the form.",
        details: parsed.error.flatten().fieldErrors,
      };
    }

    const id = typeof raw["id"] === "string" && raw["id"] ? raw["id"] : null;
    const item = await sales.upsertCatalogItem(actor, id, parsed.data);

    revalidatePath("/admin/sales/catalog");
    revalidatePath("/admin/sales/proposals/new");
    return { ok: true, data: { id: item.id } };
  } catch (error) {
    actionLog.warn({ err: error }, "saveCatalogItem refused or failed");
    return toActionFailure(error);
  }
}
