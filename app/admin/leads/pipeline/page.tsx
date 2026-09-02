import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { boardLeads, pipelineCounts, seesWholeTeam } from "@/lib/services/crm.service";
import { Button, Card, CardBody } from "@/components/ui";
import { TERMINAL_STAGES, STAGE_LABEL } from "@/lib/crm/pipeline";
import { PipelineBoard } from "./board";

export const metadata: Metadata = { title: "Pipeline" };
export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const actor = await requireActorPage("/admin/leads/pipeline");

  const [leads, counts] = await Promise.all([boardLeads(actor), pipelineCounts(actor)]);

  return (
    <>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-2xs font-semibold uppercase tracking-widest text-brand-red">CRM</p>
          <h1 className="mt-1.5 text-2xl text-navy-800">Pipeline</h1>
          <p className="mt-1.5 text-xs text-ink-subtle">
            {seesWholeTeam(actor) ? "Every open lead." : "Your open leads."} Drag a card, or use the
            stage selector on it.
          </p>
        </div>
        <Link href="/admin/leads">
          <Button variant="secondary" size="sm">
            List view
          </Button>
        </Link>
      </header>

      {leads.length === 0 ? (
        <Card>
          <CardBody className="py-12 text-center">
            <p className="text-sm font-medium text-navy-800">No open leads</p>
            <p className="mx-auto mt-1.5 max-w-md text-xs text-ink-subtle">
              Leads appear on the board as the website captures them.
            </p>
          </CardBody>
        </Card>
      ) : (
        <PipelineBoard leads={leads} canMove={can(actor, "leads.edit")} />
      )}

      <div className="mt-5 flex flex-wrap gap-4 border-t border-line pt-4 text-xs text-ink-subtle">
        {TERMINAL_STAGES.map((stage) => (
          <span key={stage}>
            {STAGE_LABEL[stage]}: <span className="tabular-nums text-navy-800">{counts[stage] ?? 0}</span>
          </span>
        ))}
      </div>
    </>
  );
}
