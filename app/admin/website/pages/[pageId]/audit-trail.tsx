import { History } from "lucide-react";

/**
 * The page's audit trail.
 *
 * A server component reading rows the services already wrote. Deliberately
 * summary-level: who did what and when. The before/after snapshots are in the
 * audit log itself, and putting a diff of arbitrary section JSON in front of
 * an editor would be noise rather than information.
 */

const DATE = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const WORDING: Record<string, string> = {
  CREATE: "created",
  UPDATE: "updated",
  DELETE: "deleted",
  PUBLISH: "published",
  UNPUBLISH: "unpublished",
  RESTORE: "restored",
};

const SUBJECT: Record<string, string> = {
  Page: "the page",
  PageSeo: "the SEO settings",
  PageSection: "a section",
};

export type AuditEntry = {
  id: string;
  action: string;
  entityType: string;
  createdAt: Date;
  actor: { name: string } | null;
};

export function AuditTrail({ entries }: { entries: readonly AuditEntry[] }) {
  return (
    <section aria-labelledby="audit-heading" className="mt-10 max-w-2xl">
      <h2 id="audit-heading" className="flex items-center gap-2 text-lg text-navy-800">
        <History size={17} aria-hidden="true" className="text-ink-subtle" />
        History
      </h2>

      {entries.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-line-strong px-4 py-6 text-center text-sm text-ink-subtle">
          Nothing recorded yet.
        </p>
      ) : (
        <ol className="mt-4 border-t border-line">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-wrap items-baseline gap-x-2 border-b border-line py-2.5 text-sm"
            >
              <span className="font-medium text-navy-800">
                {/* A null actor is the SYSTEM identity — automation and cron. */}
                {entry.actor?.name ?? "System"}
              </span>
              <span className="text-ink-muted">
                {WORDING[entry.action] ?? entry.action.toLowerCase()}{" "}
                {SUBJECT[entry.entityType] ?? entry.entityType}
              </span>
              <span className="ml-auto text-xs tabular-nums text-ink-subtle">
                {DATE.format(entry.createdAt)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
