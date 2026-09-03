import type { Metadata } from "next";
import { requireActorPage } from "@/lib/actor";
import { listNotifications } from "@/lib/services/notification.service";
import { NotificationList } from "./notification-list";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const actor = await requireActorPage("/admin/notifications");
  // Scoped to the caller by construction — there is no parameter for whose.
  const notifications = await listNotifications(actor, 50);

  return (
    <>
      <header className="mb-5">
        <h1 className="text-2xl text-navy-800">Notifications</h1>
        <p className="mt-1.5 text-xs text-ink-subtle">
          What has happened that you own. The same events are emailed to you, and every send is
          recorded under Settings.
        </p>
      </header>

      <NotificationList
        notifications={notifications.map((notification) => ({
          id: notification.id,
          title: notification.title,
          body: notification.body,
          href: notification.href,
          readAt: notification.readAt ? notification.readAt.toISOString() : null,
          createdAt: notification.createdAt.toISOString(),
        }))}
      />
    </>
  );
}
