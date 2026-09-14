import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { experimentResults, listExperiments } from "@/lib/services/experiment.service";
import { ExperimentList, type ExperimentRow } from "./experiment-list";

export const metadata: Metadata = { title: "Experiments" };
export const dynamic = "force-dynamic";

export default async function ExperimentsPage() {
  const actor = await requireActorPage("/admin/website/experiments");
  requirePermission(actor, "pages.view");

  const experiments = await listExperiments(actor);

  const rows: ExperimentRow[] = await Promise.all(
    experiments.map(async (experiment) => {
      const { arms, reading } = await experimentResults(actor, experiment.id);
      return {
        id: experiment.id,
        key: experiment.key,
        name: experiment.name,
        hypothesis: experiment.hypothesis,
        status: experiment.status,
        startedAt: experiment.startedAt ? experiment.startedAt.toISOString() : null,
        arms,
        sections: experiment.variants.reduce((sum, v) => sum + v._count.sections, 0),
        reading:
          reading.state === "no-data" || reading.state === "too-early"
            ? { state: reading.state, needed: reading.needed }
            : reading.state === "no-difference"
              ? { state: reading.state, pValue: reading.pValue }
              : { state: reading.state, pValue: reading.pValue, leader: reading.leader },
      };
    }),
  );

  return (
    <>
      <header className="mb-5">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/website" className="hover:text-brand-red">
            Website
          </Link>
          <span> / Experiments</span>
        </nav>
        <h1 className="mt-1.5 text-2xl text-navy-800">Experiments</h1>
        <p className="mt-1.5 max-w-2xl text-xs text-ink-subtle">
          Show a share of visitors a different band and see which produces more enquiries. A
          visitor always sees the same arm, and conversions are counted through the same
          attribution the CRM already records — no separate tracking, and no second definition of
          what a lead is.
        </p>
      </header>

      <ExperimentList rows={rows} canManage={can(actor, "pages.publish")} />
    </>
  );
}
