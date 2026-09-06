import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { pageParamsSchema } from "@/lib/paging";
import { Pagination } from "@/components/admin/pagination";
import { can, requirePermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { dueRetainers, listRetainers } from "@/lib/services/retainer.service";
import { formatMoney } from "@/lib/money";
import { BILLING_CYCLE_LABEL } from "@/lib/finance/invoice";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Table,
  TableEmpty,
  TableWrap,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui";
import { NewRetainer, RetainerStatusControl } from "./retainer-panels";
import type { RetainerStatus } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Retainers" };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

const TONE: Record<RetainerStatus, "neutral" | "navy" | "warning" | "success" | "red"> = {
  ACTIVE: "success",
  PAUSED: "warning",
  CANCELLED: "neutral",
  EXPIRED: "neutral",
};

const LABEL: Record<RetainerStatus, string> = {
  ACTIVE: "Active",
  PAUSED: "Paused",
  CANCELLED: "Ended",
  EXPIRED: "Expired",
};

export default async function RetainersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireActorPage("/admin/finance/retainers");

  const parsed = pageParamsSchema.safeParse(await searchParams);
  const params = parsed.success ? parsed.data : pageParamsSchema.parse({});
  requirePermission(actor, "retainers.view");

  const [retainers, due, clients] = await Promise.all([
    listRetainers(actor, params),
    dueRetainers(actor),
    can(actor, "retainers.create")
      ? db.client.findMany({
          where: { deletedAt: null },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const canEdit = can(actor, "retainers.edit");

  return (
    <>
      <header className="mb-5">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/finance" className="hover:text-navy-800">
            Finance
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">Retainers</span>
        </nav>
        <h1 className="mt-1.5 text-2xl text-navy-800">Retainers</h1>
        <p className="mt-1.5 text-xs text-ink-subtle">
          Recurring work. A retainer does not invoice itself — billing raises the drafts and moves
          each retainer on to its next period, so running it twice cannot bill the same period
          twice.
        </p>
      </header>

      {due.length > 0 ? (
        <div className="mb-5 rounded-lg border border-warning/30 bg-warning-bg px-3.5 py-3 text-sm text-warning">
          {due.length} retainer{due.length === 1 ? " is" : "s are"} due to be billed:{" "}
          {due.map((row) => `${row.client.name} — ${row.name}`).join(", ")}.{" "}
          <Link href="/admin/finance" className="font-medium underline underline-offset-2">
            Bill them from Finance
          </Link>
          .
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Client</TH>
                  <TH>Covers</TH>
                  <TH className="text-right">Per cycle</TH>
                  <TH>Cycle</TH>
                  <TH>Next bill</TH>
                  <TH className="text-right">Invoices</TH>
                  <TH>Status</TH>
                  {canEdit ? (
                    <TH className="text-right">
                      <span className="sr-only">Actions</span>
                    </TH>
                  ) : null}
                </TR>
              </THead>
              <TBody>
                {retainers.rows.length === 0 ? (
                  <TableEmpty
                    colSpan={canEdit ? 8 : 7}
                    title="No retainers yet"
                    description="Put a client on a recurring fee and it will be billed on its cycle."
                  />
                ) : (
                  retainers.rows.map((retainer) => (
                    <TR key={retainer.id}>
                      <TD className="text-navy-800">{retainer.client.name}</TD>
                      <TD>{retainer.name}</TD>
                      <TD className="text-right tabular-nums">
                        {formatMoney(retainer.amount, retainer.currency)}
                      </TD>
                      <TD className="text-xs text-ink-muted">
                        {BILLING_CYCLE_LABEL[retainer.cycle]}
                      </TD>
                      <TD className="text-xs text-ink-subtle">
                        {retainer.status === "ACTIVE" ? DATE.format(retainer.nextBillingAt) : "—"}
                      </TD>
                      <TD className="text-right tabular-nums text-ink-muted">
                        {retainer._count.invoices}
                      </TD>
                      <TD>
                        <Badge tone={TONE[retainer.status]}>{LABEL[retainer.status]}</Badge>
                      </TD>
                      {canEdit ? (
                        <TD className="text-right">
                          <RetainerStatusControl
                            retainerId={retainer.id}
                            status={retainer.status}
                          />
                        </TD>
                      ) : null}
                    </TR>
                  ))
                )}
              </TBody>
            </Table>
          </TableWrap>

          <Pagination
            basePath="/admin/finance/retainers"
            params={params}
            page={retainers.page}
            pages={retainers.pages}
            total={retainers.total}
            perPage={retainers.perPage}
          />
        </div>

        {can(actor, "retainers.create") ? (
          <aside>
            <Card>
              <CardHeader>
                <CardTitle>New retainer</CardTitle>
              </CardHeader>
              <CardBody>
                <NewRetainer clients={clients} />
              </CardBody>
            </Card>
          </aside>
        ) : null}
      </div>
    </>
  );
}
