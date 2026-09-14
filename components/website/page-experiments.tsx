import { readVisitorContext } from "@/lib/attribution/server";
import { assignedArms } from "@/lib/content/personalise";
import { ExperimentBeacon } from "@/components/website/experiment-beacon";
import type { PublishedPage } from "@/lib/content/queries";

/**
 * Mount the exposure beacon for whatever tests this page is in.
 *
 * A server component so the assignment stays on the server: the client is told
 * only which arm it is in, never the others or how they are weighted.
 *
 * Renders nothing at all for a page with no running experiment, which is every
 * page most of the time.
 */
export async function PageExperiments({ page }: { page: PublishedPage }) {
  if (Object.keys(page.variants).length === 0) return null;

  const context = await readVisitorContext();
  const arms = await assignedArms(page, context.visitorId);
  if (arms.length === 0) return null;

  return <ExperimentBeacon arms={arms} />;
}
