"use client";

import * as React from "react";
import { useTransition } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "../settings/email/actions";

/** In-app notifications for the signed-in user. */

const WHEN = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

export function NotificationList({
  notifications,
}: {
  notifications: {
    id: string;
    title: string;
    body: string | null;
    href: string | null;
    readAt: string | null;
    createdAt: string;
  }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const unread = notifications.filter((notification) => !notification.readAt).length;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs text-ink-subtle">
          {unread === 0 ? "Nothing unread." : `${unread} unread`}
        </p>
        {unread > 0 ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await markAllNotificationsReadAction();
                router.refresh();
              })
            }
          >
            Mark all read
          </Button>
        ) : null}
      </div>

      {notifications.length === 0 ? (
        <div className="rounded-lg border border-line bg-white px-4 py-10 text-center">
          <p className="text-sm text-ink-subtle">Nothing here yet.</p>
        </div>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-white" aria-busy={pending}>
          {notifications.map((notification) => (
            <li
              key={notification.id}
              className={`flex flex-wrap items-start justify-between gap-3 px-3.5 py-3 ${
                notification.readAt ? "" : "bg-navy-50/40"
              }`}
            >
              <div className="min-w-0">
                <p className="text-sm text-navy-800">
                  {notification.href ? (
                    // The href is written by the server when the notification is
                    // created, from a route it knows exists.
                    <Link href={notification.href as Route} className="hover:text-brand-red">
                      {notification.title}
                    </Link>
                  ) : (
                    notification.title
                  )}
                </p>
                {notification.body ? (
                  <p className="text-xs text-ink-subtle">{notification.body}</p>
                ) : null}
                <p className="mt-0.5 text-2xs text-ink-subtle">
                  {WHEN.format(new Date(notification.createdAt))}
                </p>
              </div>

              {notification.readAt ? null : (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      await markNotificationReadAction(notification.id);
                      router.refresh();
                    })
                  }
                  className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-line-strong px-1.5 py-1 text-2xs text-navy-800 hover:border-brand-red hover:text-brand-red"
                >
                  <Check size={11} aria-hidden="true" />
                  Mark read
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
