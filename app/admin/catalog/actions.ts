"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/actor";
import { citySchema, serviceCityPageSchema, localFaqSchema } from "@/lib/validation/local";
import * as cityService from "@/lib/services/city.service";
import * as pageService from "@/lib/services/serviceCityPage.service";
import { toActionFailure, type ActionResult } from "@/lib/errors";
import { log } from "@/lib/logger";

/**
 * Catalog server actions.
 *
 * Each one: authenticate, validate with zod, then hand off to the service,
 * which performs the permission check and writes the audit row. No business
 * logic lives here (CLAUDE.md 4).
 */

const actionLog = log("catalog");

function fields(formData: FormData) {
  return Object.fromEntries(formData.entries());
}

/** Comma or newline separated list, trimmed and de-duplicated. */
function parseList(value: FormDataEntryValue | null): string[] {
  if (typeof value !== "string") return [];
  const items = value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set(items)];
}

export type CityActionState = ActionResult<{ id: string }> | null;

export async function saveCityAction(
  _prev: CityActionState,
  formData: FormData,
): Promise<CityActionState> {
  try {
    const actor = await requireActor();
    const raw = fields(formData);

    const parsed = citySchema.safeParse({
      ...raw,
      isActive: raw["isActive"] === "on" || raw["isActive"] === "true",
      latitude: raw["latitude"] === "" ? null : raw["latitude"],
      longitude: raw["longitude"] === "" ? null : raw["longitude"],
      population: raw["population"] === "" ? null : raw["population"],
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
    const city = id
      ? await cityService.updateCity(actor, id, parsed.data)
      : await cityService.createCity(actor, parsed.data);

    revalidatePath("/admin/catalog/cities");
    return { ok: true, data: { id: city.id } };
  } catch (error) {
    actionLog.error({ err: error }, "saveCity failed");
    return toActionFailure(error);
  }
}

export async function toggleCityActiveAction(id: string, isActive: boolean): Promise<void> {
  const actor = await requireActor();
  await cityService.setCityActive(actor, id, isActive);
  revalidatePath("/admin/catalog/cities");
}

export type PageActionState = ActionResult<{ id: string }> | null;

export async function saveServiceCityPageAction(
  _prev: PageActionState,
  formData: FormData,
): Promise<PageActionState> {
  try {
    const actor = await requireActor();
    const raw = fields(formData);

    const parsed = serviceCityPageSchema.safeParse({
      ...raw,
      industries: parseList(formData.get("industries")),
      localIntro: raw["localIntro"] || null,
      marketContext: raw["marketContext"] || null,
      positioning: raw["positioning"] || null,
      ctaHeading: raw["ctaHeading"] || null,
      ctaBody: raw["ctaBody"] || null,
      metaTitle: raw["metaTitle"] || null,
      metaDescription: raw["metaDescription"] || null,
      canonical: raw["canonical"] || null,
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
    const page = id
      ? await pageService.updatePage(actor, id, parsed.data)
      : await pageService.createPage(actor, parsed.data);

    revalidatePath("/admin/catalog/service-cities");
    return { ok: true, data: { id: page.id } };
  } catch (error) {
    actionLog.error({ err: error }, "saveServiceCityPage failed");
    return toActionFailure(error);
  }
}

export type PublishState = ActionResult<{ status: string }> | null;

/**
 * Publish. The refusal path matters as much as the success path: the reasons
 * come back to the UI so the author can see what is missing.
 */
export async function publishPageAction(
  _prev: PublishState,
  formData: FormData,
): Promise<PublishState> {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) {
    return { ok: false, code: "VALIDATION", message: "Missing page." };
  }

  try {
    const actor = await requireActor();
    const shouldPublish = formData.get("intent") === "publish";

    const page = shouldPublish
      ? await pageService.publishPage(actor, id)
      : await pageService.unpublishPage(actor, id);

    revalidatePath("/admin/catalog/service-cities");
    revalidatePath(`/admin/catalog/service-cities/${id}`);
    return { ok: true, data: { status: page.status } };
  } catch (error) {
    actionLog.warn({ err: error }, "publish refused or failed");
    return toActionFailure(error);
  }
}

export async function addLocalFaqAction(
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }> | null> {
  try {
    const actor = await requireActor();
    const parsed = localFaqSchema.safeParse({
      serviceCityPageId: formData.get("serviceCityPageId"),
      question: formData.get("question"),
      answer: formData.get("answer"),
      order: formData.get("order") || 0,
    });

    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check the form.",
      };
    }

    const faq = await pageService.addLocalFaq(actor, parsed.data);
    revalidatePath(`/admin/catalog/service-cities/${parsed.data.serviceCityPageId}`);
    return { ok: true, data: { id: faq.id } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function deleteLocalFaqAction(id: string, pageId: string): Promise<void> {
  const actor = await requireActor();
  await pageService.deleteLocalFaq(actor, id);
  revalidatePath(`/admin/catalog/service-cities/${pageId}`);
}
