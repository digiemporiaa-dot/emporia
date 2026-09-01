"use client";

import * as React from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * Toast notifications.
 *
 * Announced through an `aria-live` region so a screen reader user learns that
 * an action succeeded or failed, not just a sighted one.
 */

export type ToastTone = "success" | "error" | "info";

export type Toast = {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
};

type ToastContextValue = {
  toasts: readonly Toast[];
  push: (toast: Omit<Toast, "id">) => void;
  dismiss: (id: string) => void;
};

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

const ICONS: Record<ToastTone, React.ComponentType<{ size?: number; className?: string }>> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

const TONES: Record<ToastTone, string> = {
  success: "border-success/30 text-success",
  error: "border-red-100 text-brand-red",
  info: "border-navy-100 text-navy-700",
};

const AUTO_DISMISS_MS = 6000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const timers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = React.useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = React.useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = crypto.randomUUID();
      setToasts((current) => [...current, { ...toast, id }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), AUTO_DISMISS_MS),
      );
    },
    [dismiss],
  );

  React.useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const value = React.useMemo(() => ({ toasts, push, dismiss }), [toasts, push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="region"
        aria-label="Notifications"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
      >
        <div aria-live="polite" aria-atomic="false" className="contents">
          {toasts.map((toast) => {
            const Icon = ICONS[toast.tone];
            return (
              <div
                key={toast.id}
                className={cn(
                  "pointer-events-auto flex items-start gap-2.5 rounded-md border bg-white px-3.5 py-3 shadow-md",
                  TONES[toast.tone],
                )}
              >
                <Icon size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-navy-800">{toast.title}</p>
                  {toast.description ? (
                    <p className="mt-0.5 text-xs text-ink-muted">{toast.description}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(toast.id)}
                  className="shrink-0 rounded-sm p-0.5 text-ink-subtle hover:bg-surface-muted hover:text-navy-800"
                >
                  <X size={14} aria-hidden="true" />
                  <span className="sr-only">Dismiss</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </ToastContext.Provider>
  );
}
