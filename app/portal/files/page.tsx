import type { Metadata } from "next";
import { requirePortalActorPage } from "@/lib/actor/portal";
import { listFiles } from "@/lib/services/portal.service";
import { Card, CardBody } from "@/components/ui";

export const metadata: Metadata = { title: "Files" };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function PortalFilesPage() {
  const actor = await requirePortalActorPage();
  const files = await listFiles(actor);

  return (
    <>
      <header className="mb-5">
        <h1 className="text-2xl text-navy-800">Files</h1>
        <p className="mt-1.5 text-xs text-ink-subtle">
          Everything attached to your contracts, approvals and content.
        </p>
      </header>

      {files.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-ink-subtle">No files yet.</p>
            <p className="mt-2 text-xs text-ink-subtle">
              Files appear here as they are attached to your contracts, approvals and content.
              Uploading from this side is not available — send anything you need to share through
              Messages.
            </p>
          </CardBody>
        </Card>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-white">
          {files.map((file) => (
            <li key={file.id} className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5">
              <div className="min-w-0">
                <a
                  href={file.url}
                  rel="noreferrer noopener"
                  target="_blank"
                  className="text-sm text-navy-800 hover:text-brand-red"
                >
                  {file.filename}
                </a>
                <p className="text-2xs text-ink-subtle">{file.context}</p>
              </div>
              <span className="shrink-0 text-2xs tabular-nums text-ink-subtle">
                {size(file.size)} · {DATE.format(file.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
