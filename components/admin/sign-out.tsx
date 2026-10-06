"use client";

import { LogOut } from "lucide-react";
import { useTransition } from "react";

/** `dark` for the navy admin sidebar, `light` for the portal's white header. */
export function SignOutButton({ action, tone = "dark" }: { action: () => Promise<void>; tone?: "dark" | "light" }) {
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => void (await action()))}
      className={`flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors disabled:opacity-60 ${
        tone === "light" ? "text-ink-muted hover:bg-surface-muted hover:text-navy-800" : "text-navy-100 hover:bg-navy-700/60 hover:text-white"
      }`}
    >
      <LogOut size={16} aria-hidden="true" />
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
