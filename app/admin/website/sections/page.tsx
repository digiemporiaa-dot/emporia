import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { listReusableSections } from "@/lib/services/reusable-section.service";
import { reusableListSchema } from "@/lib/validation/page";
import { blockDefinition, isBlockType } from "@/lib/content/blocks";
import { Badge, Button, Table, TableEmpty, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui";
import { Pagination } from "@/components/admin/pagination";
import { PageStatusBadge } from "../pages/page-status";
import { TableSkeleton } from "../table-skeleton";
import type { Actor } from "@/lib/actor/types";
import type { ReusableListInput } from "@/lib/validation/page";

export const metadata: Metadata = { title: "Reusable sections" };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default async function ReusableSectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireActorPage("/admin/website/sections");
  const raw = await searchParams;

  const parsed = reusableListSchema.safeParse(raw);
  const params = parsed.success ? parsed.data : reusableListSchema.parse({});


  return (
    <>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-2xs font-semibold uppercase tracking-widest text-brand-red-text">
            Website
          </p>
          <h1 className="mt-1.5 text-2xl text-navy-800">Reusable sections</h1>
          <p className="mt-1.5 max-w-xl text-xs text-ink-subtle">
            A band authored once and placed on many pages. Saving a published one updates every
            page it appears on.
          </p>
        </div>
        {can(actor, "pages.create") ? (
          <Link href="/admin/website/sections/new">
            <Button size="sm">New section</Button>
          </Link>
        ) : null}
      </header>

      <Suspense key={JSON.stringify(params)} fallback={<TableSkeleton rows={5} />}>
        <SectionsTable actor={actor} params={params} />
      </Suspense>
    </>
  );
}

async function SectionsTable({ actor, params }: { actor: Actor; params: ReusableListInput }) {
  const result = await listReusableSections(actor, params);
  const canEdit = can(actor, "pages.edit");

  return (
    <>
      <TableWrap label="Reusable sections">
        <Table>
          <THead>
            <TR>
              <TH>Section</TH>
              <TH>Block</TH>
              <TH>Status</TH>
              <TH className="text-right">Used on</TH>
              <TH>Updated</TH>
            </TR>
          </THead>
          <TBody>
            {result.rows.length === 0 ? (
              <TableEmpty
                colSpan={5}
                title="No reusable sections yet"
                description="Create one when the same band belongs on more than one page — a standard call to action, say."
              />
            ) : (
              result.rows.map((row) => (
                <TR key={row.id}>
                  <TD>
                    {canEdit ? (
                      <Link
                        href={`/admin/website/sections/${row.id}`}
                        className="font-medium text-navy-800 hover:text-brand-red"
                      >
                        {row.name}
                      </Link>
                    ) : (
                      <span className="font-medium text-navy-800">{row.name}</span>
                    )}
                    <p className="font-mono text-2xs text-ink-subtle">{row.key}</p>
                  </TD>
                  <TD className="text-ink-muted">
                    {isBlockType(row.type) ? blockDefinition(row.type).label : row.type}
                  </TD>
                  <TD>
                    <div className="flex items-center gap-2">
                      <PageStatusBadge status={row.status} />
                      {row.isGlobal ? <Badge tone="navy">Global</Badge> : null}
                    </div>
                  </TD>
                  <TD className="text-right tabular-nums">
                    {row._count.usages === 0 ? (
                      <span className="text-ink-subtle">—</span>
                    ) : (
                      `${row._count.usages} page${row._count.usages === 1 ? "" : "s"}`
                    )}
                  </TD>
                  <TD className="text-xs text-ink-subtle">{DATE.format(row.updatedAt)}</TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </TableWrap>

      <Pagination
        basePath="/admin/website/sections"
        params={params}
        page={result.page}
        pages={result.pages}
        total={result.total}
        perPage={result.perPage}
      />
    </>
  );
}
