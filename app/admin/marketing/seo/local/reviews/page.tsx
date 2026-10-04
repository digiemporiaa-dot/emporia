import type { Metadata, Route } from "next";
import Link from "next/link";
import { z } from "zod";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { listProperties } from "@/lib/services/seo-intel/property.service";
import { reviewsOverview } from "@/lib/services/seo-intel/reviews.service";
import { Badge, Card, CardBody, CardHeader } from "@/components/ui";
import { SeoHeader } from "../../seo-header";
import { DATE_TIME, PropertyPicker, Stat } from "../../crawl-parts";
import { formatCount } from "../../overview-parts";
import { ActionForm } from "../../action-form";
import { syncReviewsNowAction } from "../actions";
import { DATE, LocalNav } from "../local-parts";

export const metadata: Metadata = { title: "Local SEO — Google reviews" };
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ property: z.string().max(40).optional().catch(undefined) });
const MONTH = new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });

const stars = (value: number | null) => (value === null ? "—" : value.toFixed(1));
const hours = (value: number | null) => (value === null ? "—" : value < 48 ? `${Math.round(value)} h` : `${Math.round(value / 24)} days`);

export default async function LocalReviewsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActorPage("/admin/marketing/seo/local/reviews");
  requirePermission(actor, "seo.intelligence.view");
  const raw = await searchParams;
  const params = paramsSchema.parse(Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])));
  const properties = await listProperties(actor, { status: "active" });
  const property = properties.find((candidate) => candidate.id === params.property) ?? properties[0];
  const canConnect = can(actor, "seo.intelligence.connect");
  const canManage = can(actor, "seo.intelligence.manage");
  const description =
    "Reviews on the client's Google Business listings, read once a day: how many arrive, their stars, and which are waiting for a reply. Reading only — replies are written on Google.";

  if (!property) {
    return (
      <>
        <SeoHeader current="local" title="Google reviews" description={description} canConnect={canConnect} />
        <p className="text-sm text-ink-subtle">Add a website first.</p>
      </>
    );
  }

  const overview = await reviewsOverview(actor, property.id);
  const t = overview.thresholds;

  return (
    <>
      <SeoHeader
        current="local"
        title="Google reviews"
        description={description}
        query={`?property=${property.id}`}
        canConnect={canConnect}
        crumbs={[{ href: `/admin/marketing/seo/local?property=${property.id}` as Route, label: "Local SEO" }]}
      />
      <PropertyPicker id="reviews-property" properties={properties} current={property.id} />
      <LocalNav current="reviews" propertyId={property.id} />

      {overview.locations.length === 0 ? (
        <Card>
          <CardBody className="text-sm text-ink-subtle">
            {property.client.name} has no Google Business location connected.{" "}
            <Link href={`/admin/clients/${property.client.id}/social/accounts` as Route} className="text-navy-800 underline underline-offset-2">
              Connect one in the client&rsquo;s social accounts
            </Link>
            ; its reviews are read from the next day on.
          </CardBody>
        </Card>
      ) : (
        <>
          {canManage ? (
            <div className="mb-5">
              <ActionForm action={syncReviewsNowAction} label="Read reviews now" pendingLabel="Reading…" variant="secondary" hidden={{ propertyId: property.id }} />
            </div>
          ) : null}
          <div className="space-y-6">
            {overview.locations.map((location) => {
              const peak = Math.max(1, ...location.monthly.map((month) => month.count));
              return (
                <Card key={location.id}>
                  <CardHeader>
                    <h2 className="text-base text-navy-800">
                      {location.name} {location.status !== "CONNECTED" ? <Badge tone="warning">Needs reconnecting</Badge> : null}
                    </h2>
                    <p className="text-2xs text-ink-subtle">
                      {location.listing?.lastSyncedAt ? `Read ${DATE_TIME.format(location.listing.lastSyncedAt)}` : "Not read yet"}
                      {location.listing?.complete === false ? " · more reviews than one read covers; the oldest are not included" : ""}
                      {location.profileUrl ? (
                        <>
                          {" · "}
                          <a href={location.profileUrl} target="_blank" rel="noreferrer noopener" className="text-navy-800 underline underline-offset-2">
                            Open on Google
                          </a>
                        </>
                      ) : null}
                    </p>
                    {location.listing?.lastError ? (
                      <p role="alert" className="mt-1 text-xs text-brand-red-text">
                        Last read failed: {location.listing.lastError}
                      </p>
                    ) : null}
                  </CardHeader>
                  <CardBody className="space-y-5">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <Stat label="Google rating" value={stars(location.listing?.averageRating ?? null)} note={location.listing?.totalReviewCount != null ? `${formatCount(location.listing.totalReviewCount)} reviews, Google's figure` : "Not reported yet"} />
                      <Stat label="New in 30 days" value={formatCount(location.stats.last30)} note={`${formatCount(location.stats.previous30)} in the 30 before`} />
                      <Stat label="Waiting for a reply" value={formatCount(location.stats.unanswered)} note={`Last ${t.unansweredDays} days · ${location.stats.unansweredLow} at ${t.lowRating}★ or less`} />
                      <Stat label="Typical reply time" value={hours(location.stats.medianReplyHours)} note={location.stats.daysSinceLast === null ? "No reviews yet" : `Last review ${location.stats.daysSinceLast} days ago`} />
                    </div>

                    <div>
                      <h3 className="mb-2 text-sm text-navy-800">New reviews per month</h3>
                      <ol className="flex h-28 items-end gap-1" aria-label="New reviews per month">
                        {location.monthly.map((month) => (
                          <li key={month.month} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                            <span className="text-2xs tabular-nums text-ink-subtle">{month.count || ""}</span>
                            <span
                              className="w-full rounded-t-sm bg-navy-700"
                              style={{ height: `${(month.count / peak) * 70}%`, minHeight: month.count ? 2 : 0 }}
                              title={`${month.count} reviews${month.average !== null ? `, ${month.average.toFixed(1)}★ average` : ""}`}
                            />
                            <span className="w-full truncate text-center text-[10px] text-ink-subtle">{MONTH.format(new Date(`${month.month}-01T00:00:00Z`))}</span>
                          </li>
                        ))}
                      </ol>
                      <p className="mt-1 text-2xs text-ink-subtle">
                        Average of the last 90 days: {stars(location.stats.recentAverage)}★ · all stored reviews: {stars(location.stats.allAverage)}★
                      </p>
                    </div>

                    <div>
                      <h3 className="mb-2 text-sm text-navy-800">Waiting for a reply</h3>
                      {location.unanswered.length === 0 ? (
                        <p className="text-xs text-ink-subtle">Every review from the last {t.unansweredDays} days has a reply.</p>
                      ) : (
                        <ul className="divide-y divide-line">
                          {location.unanswered.map((review) => (
                            <li key={review.id} className="py-2">
                              <p className="text-xs">
                                <span className={review.rating <= t.lowRating ? "font-medium text-brand-red-text" : "font-medium text-navy-800"}>{review.rating}★</span>{" "}
                                <span className="text-ink-muted">
                                  {review.reviewerName ?? "Anonymous"} · {DATE.format(review.createdAt)}
                                </span>
                              </p>
                              {review.comment ? <p className="mt-0.5 whitespace-pre-line break-words text-xs text-ink-muted">{review.comment}</p> : <p className="mt-0.5 text-xs text-ink-subtle">Stars only, no text.</p>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </CardBody>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
