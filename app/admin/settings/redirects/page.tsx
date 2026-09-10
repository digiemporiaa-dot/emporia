import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { isPermanent, listRedirects } from "@/lib/services/redirect.service";
import { redirectListSchema } from "@/lib/validation/redirect";
import { Pagination } from "@/components/admin/pagination";
import { RedirectManager } from "./redirect-manager";

export const metadata: Metadata = { title: "Redirects" };
export const dynamic = "force-dynamic";

export default async function RedirectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireActorPage("/admin/settings/redirects");
  requirePermission(actor, "redirects.view");

  const raw = await searchParams;
  const parsed = redirectListSchema.safeParse(raw);
  const params = parsed.success ? parsed.data : redirectListSchema.parse({});

  const result = await listRedirects(actor, params);

  return (
    <>
      <header className="mb-5">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/settings" className="hover:text-brand-red">
            Settings
          </Link>
          <span> / Redirects</span>
        </nav>
        <h1 className="mt-1.5 text-2xl text-navy-800">Redirects</h1>
        <p className="mt-1.5 max-w-2xl text-xs text-ink-subtle">
          When a page changes address, a redirect keeps the old one working and moves its ranking
          to the new one. A loop is refused when you save it, not discovered when a visitor hits
          it.
        </p>
      </header>

      <RedirectManager
        rows={result.rows.map((row) => ({
          id: row.id,
          fromPath: row.fromPath,
          toPath: row.toPath,
          permanent: isPermanent(row.type),
          isActive: row.isActive,
          hits: row.hits,
          // Dates cross the boundary as ISO strings.
          lastHitAt: row.lastHitAt ? row.lastHitAt.toISOString() : null,
        }))}
        total={result.total}
        canEdit={can(actor, "redirects.edit")}
      />

      <Pagination
        basePath="/admin/settings/redirects"
        page={result.page}
        pages={result.pages}
        total={result.total}
        perPage={result.perPage}
        params={params}
      />
    </>
  );
}
