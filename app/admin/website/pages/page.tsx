import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { listPages } from "@/lib/services/page.service";
import { pageListSchema } from "@/lib/validation/page";
import { Button, Table, TableEmpty, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui";
import { Pagination } from "@/components/admin/pagination";
import { PageFilters } from "./page-filters";
import { PageStatusBadge } from "./page-status";
import { PreviewLink, RowActions } from "./row-actions";

export const metadata: Metadata = { title: "Pages" };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default async function PagesAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireActorPage("/admin/website/pages");
  const raw = await searchParams;

  // Query-string filters are validated like any other input; anything
  // unrecognised falls back to the default rather than reaching the query.
  const parsed = pageListSchema.safeParse(raw);
  const params = parsed.success ? parsed.data : pageListSchema.parse({});

  // listPages performs the permission check itself.
  const result = await listPages(actor, params);

  const canCreate = can(actor, "pages.create");
  const canEdit = can(actor, "pages.edit");
  const canPublish = can(actor, "pages.publish");
  const canDelete = can(actor, "pages.delete");
  const inBin = params.view === "deleted";

  return (
    <>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-2xs font-semibold uppercase tracking-widest text-brand-red-text">
            Website
          </p>
          <h1 className="mt-1.5 text-2xl text-navy-800">Pages</h1>
          <p className="mt-1.5 text-xs text-ink-subtle">
            CMS pages served at the top level of the site, such as{" "}
            <span className="font-mono">/seo-audit-offer</span>.
          </p>
        </div>
        {canCreate && !inBin ? (
          <Link href="/admin/website/pages/new">
            <Button size="sm">New page</Button>
          </Link>
        ) : null}
      </header>

      <PageFilters params={params} />

      <div className="mt-4">
        <TableWrap>
          <Table>
            <THead>
              <TR>
                <TH>Page</TH>
                <TH>Slug</TH>
                <TH>Status</TH>
                <TH className="text-right">Sections</TH>
                <TH>Updated</TH>
                <TH>
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {result.rows.length === 0 ? (
                <TableEmpty
                  colSpan={6}
                  title={inBin ? "The bin is empty" : "No pages match"}
                  description={
                    inBin
                      ? "Deleted pages are kept here so they can be restored."
                      : result.total === 0 && !params.query && !params.status
                        ? "Create a page to publish a landing page or campaign page."
                        : "Try widening the filters."
                  }
                />
              ) : (
                result.rows.map((row) => (
                  <TR key={row.id}>
                    <TD>
                      {canEdit && !inBin ? (
                        <Link
                          href={`/admin/website/pages/${row.id}`}
                          className="font-medium text-navy-800 hover:text-brand-red"
                        >
                          {row.title}
                        </Link>
                      ) : (
                        <span className="font-medium text-navy-800">{row.title}</span>
                      )}
                      {row.internalName ? (
                        <p className="text-xs text-ink-subtle">{row.internalName}</p>
                      ) : null}
                    </TD>
                    <TD className="font-mono text-xs text-ink-subtle">/{row.slug}</TD>
                    <TD>
                      <div className="flex items-center gap-2">
                        <PageStatusBadge status={row.status} />
                        {!inBin ? <PreviewLink id={row.id} /> : null}
                      </div>
                    </TD>
                    <TD className="text-right tabular-nums">{row._count.sections}</TD>
                    <TD className="text-xs text-ink-subtle">{DATE.format(row.updatedAt)}</TD>
                    <TD>
                      <RowActions
                        id={row.id}
                        title={row.title}
                        status={row.status}
                        deleted={inBin}
                        canEdit={canEdit}
                        canPublish={canPublish}
                        canCreate={canCreate}
                        canDelete={canDelete}
                      />
                    </TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>
        </TableWrap>

        <Pagination
          basePath="/admin/website/pages"
          params={params}
          page={result.page}
          pages={result.pages}
          total={result.total}
          perPage={result.perPage}
        />
      </div>
    </>
  );
}
