import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { pageParamsSchema } from "@/lib/paging";
import { Pagination } from "@/components/admin/pagination";
import { can } from "@/lib/auth/rbac";
import { listContracts } from "@/lib/services/sales.service";
import { formatMoney } from "@/lib/money";
import { Badge, Button, Table, TableEmpty, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui";
import type { ContractStatus } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Contracts" };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

const LABEL: Record<ContractStatus, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  SIGNED: "Signed",
  ACTIVE: "Active",
  EXPIRED: "Expired",
  TERMINATED: "Terminated",
};

const TONE: Record<ContractStatus, "neutral" | "navy" | "warning" | "success" | "red"> = {
  DRAFT: "neutral",
  SENT: "navy",
  SIGNED: "success",
  ACTIVE: "success",
  EXPIRED: "warning",
  TERMINATED: "red",
};

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireActorPage("/admin/sales/contracts");

  const parsed = pageParamsSchema.safeParse(await searchParams);
  const params = parsed.success ? parsed.data : pageParamsSchema.parse({});
  const contracts = await listContracts(actor, params);

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
            <Link href="/admin/sales" className="hover:text-navy-800">
              Sales
            </Link>
            <span aria-hidden="true"> / </span>
            <span className="text-navy-700">Contracts</span>
          </nav>
          <h1 className="mt-1.5 text-2xl text-navy-800">Contracts</h1>
        </div>
        {can(actor, "contracts.create") ? (
          <Link href="/admin/sales/contracts/new">
            <Button size="sm">New contract</Button>
          </Link>
        ) : null}
      </header>

      <TableWrap>
        <Table>
          <THead>
            <TR>
              <TH>Number</TH>
              <TH>Title</TH>
              <TH>Client</TH>
              <TH className="text-right">Value</TH>
              <TH>Status</TH>
              <TH>Starts</TH>
              <TH>Signed</TH>
            </TR>
          </THead>
          <TBody>
            {contracts.rows.length === 0 ? (
              <TableEmpty
                colSpan={7}
                title="No contracts yet"
                description="Accept a proposal and draft the contract from it."
              />
            ) : (
              contracts.rows.map((contract) => (
                <TR key={contract.id}>
                  <TD className="font-mono text-xs">
                    <Link
                      href={`/admin/sales/contracts/${contract.id}`}
                      className="font-medium text-navy-800 hover:text-brand-red"
                    >
                      {contract.number}
                    </Link>
                  </TD>
                  <TD>{contract.title}</TD>
                  <TD className="text-ink-muted">{contract.client.name}</TD>
                  <TD className="text-right tabular-nums">
                    {formatMoney(contract.value, contract.currency)}
                  </TD>
                  <TD>
                    <Badge tone={TONE[contract.status]}>{LABEL[contract.status]}</Badge>
                  </TD>
                  <TD className="text-xs text-ink-subtle">{DATE.format(contract.startsAt)}</TD>
                  <TD className="text-xs text-ink-subtle">
                    {contract.signedAt ? DATE.format(contract.signedAt) : "—"}
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </TableWrap>

      <Pagination
        basePath="/admin/sales/contracts"
        params={params}
        page={contracts.page}
        pages={contracts.pages}
        total={contracts.total}
        perPage={contracts.perPage}
      />
    </>
  );
}
