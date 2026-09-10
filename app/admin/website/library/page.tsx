import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { requireStaff } from "@/lib/auth/rbac";
import { searchContent } from "@/lib/services/cms-search.service";
import { contentSearchSchema } from "@/lib/validation/cms";
import { Pagination } from "@/components/admin/pagination";
import { LibraryTable } from "./library-table";

export const metadata: Metadata = { title: "Content library" };
export const dynamic = "force-dynamic";

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireActorPage("/admin/website/library");
  requireStaff(actor);

  const raw = await searchParams;
  const parsed = contentSearchSchema.safeParse(raw);
  const params = parsed.success ? parsed.data : contentSearchSchema.parse({});

  // Every type is filtered by its own view permission inside the service, so a
  // role that cannot see case studies gets a result with none in it — the
  // query is never issued, rather than the rows being hidden afterwards.
  const result = await searchContent(actor, {
    query: params.q,
    type: params.type,
    state: params.state,
    page: params.page,
    perPage: params.perPage,
  });

  return (
    <>
      <header className="mb-5">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/website/pages" className="hover:text-brand-red">
            Website
          </Link>
          <span> / Library</span>
        </nav>
        <h1 className="mt-1.5 text-2xl text-navy-800">Content library</h1>
        <p className="mt-1.5 max-w-2xl text-xs text-ink-subtle">
          Everything the site publishes, in one list. Select records to publish, unpublish or
          archive them together — each one goes through the same checks it would from its own
          screen, and anything refused says why.
        </p>
      </header>

      <LibraryTable
        rows={result.rows}
        total={result.total}
        countsByType={result.countsByType}
        available={result.available}
      />

      <Pagination
        basePath="/admin/website/library"
        page={result.page}
        pages={result.pages}
        total={result.total}
        perPage={result.perPage}
        params={params}
      />
    </>
  );
}
