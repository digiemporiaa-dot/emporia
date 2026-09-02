import type { Metadata } from "next";
import { requirePortalActorPage } from "@/lib/actor/portal";
import { listMessages, listProjects } from "@/lib/services/portal.service";
import { Card, CardBody } from "@/components/ui";
import { MessageForm } from "./message-form";

export const metadata: Metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

const WHEN = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

export default async function PortalMessagesPage() {
  const actor = await requirePortalActorPage();
  const [messages, projects] = await Promise.all([listMessages(actor), listProjects(actor)]);

  return (
    <>
      <header className="mb-5">
        <h1 className="text-2xl text-navy-800">Messages</h1>
        <p className="mt-1.5 text-xs text-ink-subtle">
          A single thread with your account team. Everything here is kept with your account.
        </p>
      </header>

      <Card>
        <CardBody>
          {messages.length === 0 ? (
            <p className="text-xs text-ink-subtle">
              Nothing yet. Write the first message below.
            </p>
          ) : (
            <ul className="space-y-3">
              {messages.map((message) => (
                <li
                  key={message.id}
                  className={message.fromClient ? "flex justify-end" : "flex justify-start"}
                >
                  <div
                    className={`max-w-prose rounded-lg px-3.5 py-2.5 ${
                      message.fromClient
                        ? "bg-navy-800 text-white"
                        : "border border-line bg-surface-muted text-ink"
                    }`}
                  >
                    <p className="whitespace-pre-wrap text-sm">{message.body}</p>
                    <p
                      className={`mt-1 text-2xs ${
                        message.fromClient ? "text-navy-100" : "text-ink-subtle"
                      }`}
                    >
                      {message.fromClient ? "You" : message.author.name} ·{" "}
                      {WHEN.format(message.createdAt)}
                      {message.project ? ` · ${message.project.name}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-5 border-t border-line pt-4">
            <MessageForm projects={projects.map((p) => ({ id: p.id, name: p.name }))} />
          </div>
        </CardBody>
      </Card>

      <p className="mt-3 text-2xs text-ink-subtle">
        Messages are not emailed out yet — email delivery is built in phase 12. Your account team
        sees them in the admin system.
      </p>
    </>
  );
}
