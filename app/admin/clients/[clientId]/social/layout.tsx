import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorPage } from "@/lib/actor";
import { requirePermission } from "@/lib/auth/rbac";
import { getClient } from "@/lib/services/sales.service";
import { isAppError } from "@/lib/errors";
import { SocialNav } from "./social-nav";

/**
 * The client's social media section.
 *
 * A section of the client, not a place of its own: the breadcrumb goes back to
 * the client and the tabs sit under their name, because "social media for ABC
 * Technologies" is a view of that client rather than a separate entity
 * (brief §6 — do not create a second client).
 *
 * The client is resolved once here and the permission checked once here, so
 * every page below inherits both.
 */
export default async function ClientSocialLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const actor = await requireActorPage(`/admin/clients/${clientId}/social`);
  requirePermission(actor, "social.view");

  let client;
  try {
    client = await getClient(actor, clientId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <>
      <header className="mb-6">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/clients" className="hover:text-navy-800">
            Clients
          </Link>
          <span aria-hidden="true"> / </span>
          <Link href={`/admin/clients/${client.id}`} className="hover:text-navy-800">
            {client.name}
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">Social media</span>
        </nav>
        <h1 className="mt-1.5 text-2xl text-navy-800">Social media</h1>
        <p className="mt-1.5 text-xs text-ink-subtle">{client.name}</p>
      </header>

      <SocialNav clientId={client.id} />

      <div className="mt-6">{children}</div>
    </>
  );
}
