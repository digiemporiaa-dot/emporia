import { Badge } from "@/components/ui";
import type { PublishStatus } from "@/generated/prisma/enums";

/**
 * One place that decides how a page's state reads, so the list, the editor and
 * the preview banner cannot drift apart.
 */

const TONE = {
  DRAFT: "neutral",
  PUBLISHED: "success",
  ARCHIVED: "warning",
} as const;

const LABEL = {
  DRAFT: "Draft",
  PUBLISHED: "Published",
  ARCHIVED: "Archived",
} as const;

export function PageStatusBadge({ status }: { status: PublishStatus }) {
  return <Badge tone={TONE[status]}>{LABEL[status]}</Badge>;
}
