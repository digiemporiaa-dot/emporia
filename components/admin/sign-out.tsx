"use client";

import { LogOut } from "lucide-react";
import { useTransition } from "react";

export function SignOutButton({ action }: { action: () => Promise<void> }) {
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => void (await action()))}
      className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-navy-100 transition-colors hover:bg-navy-700/60 hover:text-white disabled:opacity-60"
    >
      <LogOut size={16} aria-hidden="true" />
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
