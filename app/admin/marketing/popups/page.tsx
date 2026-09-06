import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { pageParamsSchema } from "@/lib/paging";
import { Pagination } from "@/components/admin/pagination";
import { can } from "@/lib/auth/rbac";
import { listPopups } from "@/lib/services/popup.service";
import { Badge, Button, Table, TableEmpty, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui";

export const metadata: Metadata = { title: "Popups" };

export default async function PopupsAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireActorPage("/admin/marketing/popups");

  const parsed = pageParamsSchema.safeParse(await searchParams);
  const params = parsed.success ? parsed.data : pageParamsSchema.parse({});
  const popups = await listPopups(actor, params);

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
            <Link href="/admin/marketing" className="hover:text-navy-800">
              Marketing
            </Link>
            <span aria-hidden="true"> / </span>
            <span className="text-navy-700">Popups</span>
          </nav>
          <h1 className="mt-1.5 text-2xl text-navy-800">Popups</h1>
        </div>
        {can(actor, "popups.create") ? (
          <Link href="/admin/marketing/popups/new">
            <Button size="sm">Add popup</Button>
          </Link>
        ) : null}
      </header>

      <TableWrap>
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Trigger</TH>
              <TH>Frequency</TH>
              <TH>Targets</TH>
              <TH>Priority</TH>
              <TH>Leads</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {popups.rows.length === 0 ? (
              <TableEmpty
                colSpan={7}
                title="No popups yet"
                description="Create one and target it at a page, service or city."
              />
            ) : (
              popups.rows.map((popup) => (
                <TR key={popup.id}>
                  <TD>
                    <Link
                      href={`/admin/marketing/popups/${popup.id}`}
                      className="font-medium text-navy-800 hover:text-brand-red"
                    >
                      {popup.name}
                    </Link>
                    <span className="block text-xs text-ink-subtle">{popup.title}</span>
                  </TD>
                  <TD className="text-xs text-ink-muted">{popup.trigger.toLowerCase().replace(/_/g, " ")}</TD>
                  <TD className="text-xs text-ink-muted">{popup.frequency.toLowerCase().replace(/_/g, " ")}</TD>
                  <TD className="tabular-nums">
                    {popup._count.targets === 0 ? (
                      <span className="text-warning">none</span>
                    ) : (
                      popup._count.targets
                    )}
                  </TD>
                  <TD className="tabular-nums">{popup.priority}</TD>
                  <TD className="tabular-nums">{popup._count.leads}</TD>
                  <TD>
                    <Badge tone={popup.isActive ? "success" : "neutral"}>
                      {popup.isActive ? "Active" : "Paused"}
                    </Badge>
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </TableWrap>

      <Pagination
        basePath="/admin/marketing/popups"
        params={params}
        page={popups.page}
        pages={popups.pages}
        total={popups.total}
        perPage={popups.perPage}
      />
    </>
  );
}
