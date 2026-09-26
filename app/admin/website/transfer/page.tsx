import type { Metadata } from "next";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { TRANSFER, TRANSFER_TYPES, type TransferType } from "@/lib/transfer/columns";
import { TransferPanel, type TransferOption } from "./transfer-panel";

export const metadata: Metadata = { title: "Import and export" };
export const dynamic = "force-dynamic";

/**
 * Moving content in and out as CSV.
 *
 * One screen for both directions, because they are one workflow: export what
 * is there, edit it in a spreadsheet, bring it back. The types on offer are the
 * ones this actor may actually see — a type they cannot view is not listed
 * rather than listed and refused.
 */
export default async function TransferPage() {
  const actor = await requireActorPage("/admin/website/transfer");
  requirePermission(actor, "pages.view");

  const options: TransferOption[] = TRANSFER_TYPES.filter((type) =>
    can(actor, TRANSFER[type].viewPermission),
  ).map((type: TransferType) => {
    const meta = TRANSFER[type];
    return {
      type,
      label: meta.label,
      plural: meta.plural,
      columns: meta.columns,
      omits: meta.omits,
      naturalKey: meta.naturalKey,
      canImport: can(actor, meta.editPermission),
      canCreate: can(actor, meta.createPermission),
    };
  });

  return (
    <>
      <header className="mb-6">
        <p className="text-xs text-ink-subtle">Website</p>
        <h1 className="mt-1.5 text-2xl text-navy-800">Import and export</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-ink-muted">
          Export a content type as a spreadsheet, edit it, and bring it back. Nothing is written
          until you have seen exactly what would change.
        </p>
      </header>

      {options.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong px-4 py-10 text-center text-sm text-ink-subtle">
          You do not have access to any content that can be imported or exported.
        </p>
      ) : (
        <TransferPanel options={options} />
      )}
    </>
  );
}
