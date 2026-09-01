import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorPage } from "@/lib/actor";
import { requirePermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getPopup, popupStats } from "@/lib/services/popup.service";
import { isAppError } from "@/lib/errors";
import { Badge, Card, CardBody } from "@/components/ui";
import { PopupForm } from "../popup-form";

export const metadata: Metadata = { title: "Edit popup" };

/** datetime-local wants `YYYY-MM-DDTHH:mm`. */
function toLocalInput(date: Date | null): string | null {
  if (!date) return null;
  return date.toISOString().slice(0, 16);
}

export default async function EditPopupPage({
  params,
}: {
  params: Promise<{ popupId: string }>;
}) {
  const { popupId } = await params;
  const actor = await requireActorPage("/admin/marketing/popups");
  requirePermission(actor, "popups.view");

  let popup;
  try {
    popup = await getPopup(actor, popupId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const [stats, services, cities, packages] = await Promise.all([
    popupStats(actor, popupId),
    db.service.findMany({ orderBy: { order: "asc" }, select: { id: true, name: true } }),
    db.city.findMany({ orderBy: { order: "asc" }, select: { id: true, name: true } }),
    db.servicePackage.findMany({ orderBy: { order: "asc" }, select: { id: true, name: true } }),
  ]);

  const funnel = [
    { label: "Impressions", value: stats.impressions },
    { label: "Views", value: stats.views },
    { label: "Form starts", value: stats.formStarts },
    { label: "Submissions", value: stats.submissions },
    { label: "Conversions", value: stats.conversions },
  ];

  return (
    <>
      <header className="mb-6">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/marketing/popups" className="hover:text-navy-800">
            Popups
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">{popup.name}</span>
        </nav>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl text-navy-800">{popup.name}</h1>
          <Badge tone={popup.isActive ? "success" : "neutral"}>
            {popup.isActive ? "Active" : "Paused"}
          </Badge>
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 max-w-4xl">
          <PopupForm
            services={services}
            cities={cities}
            packages={packages}
            popup={{
              id: popup.id,
              name: popup.name,
              title: popup.title,
              body: popup.body,
              ctaLabel: popup.ctaLabel,
              ctaHref: popup.ctaHref,
              trigger: popup.trigger,
              triggerValue: popup.triggerValue,
              frequency: popup.frequency,
              priority: popup.priority,
              isActive: popup.isActive,
              startsAt: toLocalInput(popup.startsAt),
              endsAt: toLocalInput(popup.endsAt),
              targets: popup.targets.map((t) => ({
                type: t.type,
                path: t.path ?? "",
                serviceId: t.serviceId ?? "",
                cityId: t.cityId ?? "",
                packageId: t.packageId ?? "",
                visitorType: t.visitorType,
                device: t.device,
              })),
            }}
          />
        </div>

        <aside className="xl:sticky xl:top-6 xl:self-start">
          <Card>
            <CardBody>
              <h2 className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
                Funnel
              </h2>
              {stats.impressions === 0 ? (
                <p className="mt-3 text-xs text-ink-subtle">
                  Nothing recorded yet. Figures appear here as the popup is shown and submitted —
                  none of them are estimated.
                </p>
              ) : (
                <dl className="mt-3 space-y-1.5 text-sm">
                  {funnel.map((row) => (
                    <div key={row.label} className="flex justify-between gap-4">
                      <dt className="text-ink-muted">{row.label}</dt>
                      <dd className="tabular-nums text-navy-800">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </CardBody>
          </Card>
        </aside>
      </div>
    </>
  );
}
