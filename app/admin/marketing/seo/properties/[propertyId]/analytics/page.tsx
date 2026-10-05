import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { isAppError } from "@/lib/errors";
import { getProperty, propertyOrigin } from "@/lib/services/seo-intel/property.service";
import { getGa4Connection, listGa4Properties, type Ga4PropertyOption } from "@/lib/services/seo-intel/ga4-connection.service";
import { googleMethodsAvailable } from "@/lib/services/seo-intel/google-settings.service";
import { recentGa4SyncRuns } from "@/lib/services/seo-intel/ga4-sync.service";
import { planGscSync } from "@/lib/seo-intel/sync-plan";
import { daysBetween, fromDbDate, todayIn } from "@/lib/seo-intel/dates";
import { Badge, Card, CardBody, CardDescription, CardHeader, CardTitle, Table, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui";
import { SeoHeader } from "../../../seo-header";
import { ActionForm } from "../../../action-form";
import { chooseGa4PropertyAction, disconnectGa4Action, ga4ServiceAccountAction, syncGa4NowAction } from "../../../ga4-actions";

export const metadata: Metadata = { title: "Google Analytics" };
export const dynamic = "force-dynamic";

const WHEN = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
const DAY = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" });

const OUTCOME: Record<string, { tone: "success" | "error" | "neutral"; text: string }> = {
  "signed-in": { tone: "success", text: "Signed in. Now choose the GA4 property for this website." },
  cancelled: { tone: "neutral", text: "Google sign-in was cancelled. Nothing changed." },
  failed: { tone: "error", text: "Google sign-in failed." },
};

export default async function AnalyticsConnectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ propertyId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { propertyId } = await params;
  const raw = await searchParams;
  const actor = await requireActorPage(`/admin/marketing/seo/properties/${propertyId}/analytics`);
  requirePermission(actor, "seo.intelligence.view");

  const property = await getProperty(actor, propertyId).catch((error: unknown) => {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const canConnect = can(actor, "seo.intelligence.connect");
  const canSync = can(actor, "seo.intelligence.manage");
  const [connection, methods, runs] = await Promise.all([getGa4Connection(actor, propertyId), googleMethodsAvailable(actor), recentGa4SyncRuns(actor, propertyId)]);

  let options: Ga4PropertyOption[] | null = null;
  let optionsError: string | null = null;
  if (connection && connection.status !== "CONNECTED" && canConnect) {
    try {
      options = await listGa4Properties(actor, propertyId);
    } catch (error) {
      optionsError = isAppError(error) ? error.publicMessage : "Google's list of Analytics properties could not be read.";
    }
  }

  const outcomeKey = typeof raw["connection"] === "string" ? raw["connection"] : null;
  const outcome = outcomeKey ? OUTCOME[outcomeKey] : null;
  const reason = typeof raw["reason"] === "string" ? raw["reason"] : null;

  let today: string;
  try {
    today = todayIn(property.ga4TimeZone ?? property.timezone);
  } catch {
    today = todayIn("UTC");
  }
  const plan = planGscSync({ today, backfilledFrom: connection?.backfilledFrom ? fromDbDate(connection.backfilledFrom) : null });
  const historyDays = connection?.backfilledFrom ? daysBetween(fromDbDate(connection.backfilledFrom), plan.end) + 1 : 0;
  const totalDays = daysBetween(plan.oldest, plan.end) + 1;

  return (
    <>
      <SeoHeader
        current="properties"
        title="Google Analytics"
        description={`${property.displayName} · ${propertyOrigin(property)} · ${property.client.name}`}
        crumbs={[{ href: "/admin/marketing/seo/properties", label: "Websites" }, { label: property.displayName }, { label: "Google Analytics" }]}
        query={`?property=${property.id}`}
        canConnect={canConnect}
      />

      {outcome ? (
        <p
          role={outcome.tone === "error" ? "alert" : "status"}
          className={
            outcome.tone === "error"
              ? "mb-4 rounded-md border border-red-100 bg-red-50 px-3.5 py-3 text-sm text-brand-red-text"
              : outcome.tone === "success"
                ? "mb-4 rounded-md border border-success/30 bg-success-bg px-3.5 py-3 text-sm text-success"
                : "mb-4 rounded-md border border-line bg-surface-muted px-3.5 py-3 text-sm text-ink-muted"
          }
        >
          {outcome.text} {outcome.tone === "error" && reason ? reason : null}
        </p>
      ) : null}

      <div className="space-y-4">
        <Card>
          <CardHeader className="flex-col items-start gap-0.5">
            <CardTitle>Connection</CardTitle>
            <CardDescription>
              GA4 sessions, key events and revenue are read with this connection and stored daily. The Google Cloud project needs the Google Analytics Data API and Admin API enabled.
            </CardDescription>
          </CardHeader>
          <CardBody className="space-y-4">
            {!connection ? (
              <>
                <p className="text-sm text-ink-muted">Not connected.</p>
                {canConnect ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-md border border-line p-4">
                      <h3 className="text-sm font-medium text-navy-800">Sign in with Google</h3>
                      <p className="mt-1 text-xs text-ink-subtle">Someone with at least Viewer access to this website&apos;s GA4 property signs in and allows read-only access.</p>
                      {methods.oauth ? (
                        <a href={`/api/seo/google/connect?propertyId=${property.id}&source=ANALYTICS`} className="mt-3 inline-flex items-center rounded-md bg-brand-red px-3.5 py-2 text-sm font-medium text-white hover:bg-red-600">
                          Sign in with Google
                        </a>
                      ) : (
                        <p className="mt-3 text-xs text-ink-subtle">Not set up yet — add the OAuth client in SEO settings.</p>
                      )}
                    </div>
                    <div className="rounded-md border border-line p-4">
                      <h3 className="text-sm font-medium text-navy-800">Use the agency&apos;s service account</h3>
                      {methods.serviceAccount ? (
                        <>
                          <p className="mt-1 text-xs text-ink-subtle">
                            In GA4 → Admin → Property access management, add <code className="break-all font-mono text-navy-800">{methods.serviceAccount}</code> as a Viewer, then continue.
                          </p>
                          <div className="mt-3">
                            <ActionForm action={ga4ServiceAccountAction} hidden={{ propertyId: property.id }} label="Continue with the service account" variant="secondary" />
                          </div>
                        </>
                      ) : (
                        <p className="mt-1 text-xs text-ink-subtle">Not set up yet — add the service account key in SEO settings.</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-ink-subtle">Someone with permission to connect data sources can set this up.</p>
                )}
              </>
            ) : (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-ink-subtle">Status</dt>
                <dd>
                  {connection.status === "CONNECTED" ? <Badge tone="success">Connected</Badge> : connection.status === "PENDING" ? <Badge tone="warning">Choose a property</Badge> : <Badge tone="red">Needs attention</Badge>}
                </dd>
                <dt className="text-ink-subtle">Method</dt>
                <dd className="text-navy-800">{connection.method === "OAUTH" ? "Google sign-in" : "Service account"}</dd>
                <dt className="text-ink-subtle">Account</dt>
                <dd className="break-all text-navy-800">{connection.accountEmail ?? "Not reported by Google"}</dd>
                {connection.ga4Property ? (
                  <>
                    <dt className="text-ink-subtle">Property</dt>
                    <dd className="break-all font-mono text-xs text-navy-800">
                      {connection.ga4Property}
                      {property.ga4Currency ? ` · ${property.ga4Currency}` : ""}
                      {property.ga4TimeZone ? ` · ${property.ga4TimeZone}` : ""}
                    </dd>
                    <dt className="text-ink-subtle">Data through</dt>
                    <dd className="text-navy-800">{connection.dataThrough ? `${DAY.format(connection.dataThrough)} (the GA4 property's own days)` : "Nothing synced yet"}</dd>
                    <dt className="text-ink-subtle">History</dt>
                    <dd className="text-navy-800">
                      {historyDays > 0 ? `${Math.min(historyDays, totalDays)} of ${totalDays} days collected` : "Not started"}
                      {historyDays > 0 && historyDays < totalDays ? " — the rest fills in a month at a time on each scheduled run" : ""}
                    </dd>
                    <dt className="text-ink-subtle">Last sync</dt>
                    <dd className="text-navy-800">{connection.lastSyncedAt ? WHEN.format(connection.lastSyncedAt) : "Never"}</dd>
                  </>
                ) : null}
                {connection.lastSyncError ? (
                  <>
                    <dt className="text-ink-subtle">Problem</dt>
                    <dd className="text-brand-red-text">{connection.lastSyncError}</dd>
                  </>
                ) : null}
              </dl>
            )}

            {connection && connection.status !== "CONNECTED" && canConnect ? (
              <div className="space-y-3 border-t border-line pt-4">
                <h3 className="text-sm font-medium text-navy-800">Choose the GA4 property</h3>
                {optionsError ? <p role="alert" className="text-sm text-brand-red-text">{optionsError}</p> : null}
                {options && options.length === 0 ? (
                  <p className="text-sm text-ink-muted">
                    This account cannot see any GA4 properties.{" "}
                    {connection.method === "SERVICE_ACCOUNT" ? "Add the service account as a Viewer in GA4 first, then reload this page." : "Sign in with an account that has access."}
                  </p>
                ) : null}
                {options && options.length > 0 ? (
                  <ActionForm action={chooseGa4PropertyAction} hidden={{ propertyId: property.id }} label="Use this property">
                    <fieldset className="space-y-1.5">
                      <legend className="sr-only">GA4 property</legend>
                      {options.map((option, index) => (
                        <label key={option.property} className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${option.matches === false ? "border-line opacity-70" : "border-navy-300"}`}>
                          <input type="radio" name="ga4Property" value={option.property} defaultChecked={index === 0 && option.matches === true} disabled={option.matches === false} className="mt-1 accent-navy-800" />
                          <span className="min-w-0">
                            <span className="block text-navy-800">{option.displayName}</span>
                            <span className="block break-all font-mono text-2xs text-ink-subtle">
                              {option.property} · {option.accountName}
                              {option.matches === false ? ` · no web stream for ${property.domain}` : option.matches === null ? " · checked when chosen" : ""}
                            </span>
                          </span>
                        </label>
                      ))}
                    </fieldset>
                  </ActionForm>
                ) : null}
              </div>
            ) : null}

            {connection ? (
              <div className="flex flex-wrap gap-6 border-t border-line pt-4">
                {connection.status === "CONNECTED" && canSync ? (
                  <ActionForm action={syncGa4NowAction} hidden={{ propertyId: property.id }} label="Sync now" pendingLabel="Syncing… this can take a minute" variant="secondary" />
                ) : null}
                {canConnect ? (
                  <ActionForm action={disconnectGa4Action} hidden={{ propertyId: property.id }} label="Disconnect" variant="danger" confirm="Disconnect Google Analytics from this website? Data already collected is kept." />
                ) : null}
              </div>
            ) : null}
            {connection?.status === "CONNECTED" ? (
              <p className="text-xs text-ink-subtle">
                See the numbers in{" "}
                <Link href={`/admin/marketing/seo/revenue?property=${property.id}` as Route} className="text-navy-800 underline underline-offset-2">
                  Organic → revenue
                </Link>
                .
              </p>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="flex-col items-start gap-0.5">
            <CardTitle>Recent syncs</CardTitle>
          </CardHeader>
          <CardBody>
            {runs.length === 0 ? (
              <p className="text-sm text-ink-subtle">No syncs yet.</p>
            ) : (
              <TableWrap>
                <Table>
                  <THead>
                    <TR>
                      <TH>Started</TH>
                      <TH>Trigger</TH>
                      <TH>Days</TH>
                      <TH>Rows</TH>
                      <TH>Result</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {runs.map((run) => (
                      <TR key={run.id}>
                        <TD className="whitespace-nowrap text-xs">{WHEN.format(run.startedAt)}</TD>
                        <TD className="text-xs text-ink-muted">{run.trigger === "MANUAL" ? "Sync now" : "Scheduled"}</TD>
                        <TD className="tabular-nums">{run.daysWritten}</TD>
                        <TD className="tabular-nums">{run.rowsWritten.toLocaleString("en-IN")}</TD>
                        <TD>
                          <Badge tone={run.status === "SUCCEEDED" ? "success" : run.status === "RUNNING" ? "navy" : run.status === "PARTIAL" ? "warning" : "red"}>
                            {run.status === "SUCCEEDED" ? "Done" : run.status === "RUNNING" ? "Running" : run.status === "PARTIAL" ? "Partly done" : "Failed"}
                          </Badge>
                          {run.error ? <p className="mt-1 max-w-md text-2xs text-ink-subtle">{run.error}</p> : null}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
