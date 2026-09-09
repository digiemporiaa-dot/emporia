"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/actor";
import { citySchema, serviceCityPageSchema, localFaqSchema } from "@/lib/validation/local";
import * as cityService from "@/lib/services/city.service";
import * as pageService from "@/lib/services/serviceCityPage.service";
import * as packageService from "@/lib/services/package.service";
import * as serviceService from "@/lib/services/service.service";
import { packageSchema } from "@/lib/validation/package";
import { serviceSchema } from "@/lib/validation/content";
import { toActionFailure, type ActionResult } from "@/lib/errors";
import { isSeoEntity, updateEntitySeo } from "@/lib/services/seo.service";
import { pageSeoSchema } from "@/lib/validation/seo";
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

export type PackageActionState = ActionResult<{ id: string }> | null;

/** Features arrive as JSON from the client editor, so they are parsed then validated. */
function parseFeatures(value: FormDataEntryValue | null): unknown {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is { label: string; detail?: string; isIncluded?: boolean } =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as { label?: unknown }).label === "string",
      )
      .filter((item) => item.label.trim().length > 0)
      .map((item) => ({
        label: item.label,
        detail: item.detail ? item.detail : null,
        isIncluded: item.isIncluded !== false,
      }));
  } catch {
    return [];
  }
}

export async function savePackageAction(
  _prev: PackageActionState,
  formData: FormData,
): Promise<PackageActionState> {
  try {
    const actor = await requireActor();
    const raw = fields(formData);

    const parsed = packageSchema.safeParse({
      ...raw,
      isRecommended: raw["isRecommended"] === "on" || raw["isRecommended"] === "true",
      tagline: raw["tagline"] || null,
      serviceId: raw["serviceId"] || null,
      features: parseFeatures(formData.get("features")),
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
    const pkg = id
      ? await packageService.updatePackage(actor, id, parsed.data)
      : await packageService.createPackage(actor, parsed.data);

    revalidatePath("/admin/catalog/packages");
    return { ok: true, data: { id: pkg.id } };
  } catch (error) {
    actionLog.error({ err: error }, "savePackage failed");
    return toActionFailure(error);
  }
}

/**
 * Save the SEO record for a catalog entity.
 *
 * One action for cities, packages and service-city pages: the shape is the
 * same for all of them, and the service resolves the entity from a closed
 * whitelist rather than trusting the form field as a model name.
 */
export async function saveEntitySeoAction(
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }> | null> {
  try {
    const actor = await requireActor();
    const raw = fields(formData);

    const entity = typeof raw["entity"] === "string" ? raw["entity"] : "";
    const id = typeof raw["id"] === "string" ? raw["id"] : "";
    if (!isSeoEntity(entity) || !id) {
      return { ok: false, code: "VALIDATION", message: "Missing or unknown record." };
    }

    const parsed = pageSeoSchema.safeParse({
      ...raw,
      // Unchecked boxes are absent from FormData entirely, which is not the
      // same as false unless it is made so here.
      robotsIndex: raw["robotsIndex"] === "on",
      robotsFollow: raw["robotsFollow"] === "on",
    });
    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check the SEO fields.",
        details: parsed.error.flatten().fieldErrors,
      };
    }

    await updateEntitySeo(actor, entity, id, parsed.data);

    revalidatePath("/admin/catalog");
    return { ok: true, data: { id } };
  } catch (error) {
    actionLog.error({ err: error }, "save entity seo failed");
    return toActionFailure(error);
  }
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export type ServiceActionState = ActionResult<{ id: string }> | null;

export async function saveServiceAction(
  _prev: ServiceActionState,
  formData: FormData,
): Promise<ServiceActionState> {
  try {
    const actor = await requireActor();
    const raw = fields(formData);
    const id = typeof raw["id"] === "string" ? raw["id"] : "";

    const bodyField = formData.get("body");
    let body: unknown = {};
    if (typeof bodyField === "string" && bodyField.trim() !== "") {
      try {
        body = JSON.parse(bodyField);
      } catch {
        body = null;
      }
    }

    const parsed = serviceSchema.safeParse({ ...raw, body });
    if (!parsed.success) {
      const details: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".");
        (details[key] ??= []).push(issue.message);
      }
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check the form.",
        details,
      };
    }

    const service = id
      ? await serviceService.updateService(actor, id, parsed.data)
      : await serviceService.createService(actor, parsed.data);

    revalidatePath("/admin/catalog/services");
    return { ok: true, data: { id: service.id } };
  } catch (error) {
    actionLog.error({ err: error }, "saveService failed");
    return toActionFailure(error);
  }
}

export async function deleteServiceAction(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    await serviceService.deleteService(actor, id);
    revalidatePath("/admin/catalog/services");
    return { ok: true, data: { id } };
  } catch (error) {
    actionLog.error({ err: error }, "deleteService failed");
    return toActionFailure(error);
  }
}
