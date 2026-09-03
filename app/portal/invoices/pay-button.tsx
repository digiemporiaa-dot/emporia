"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

/**
 * Paying an invoice online.
 *
 * The flow is deliberately modest about what it knows. Opening checkout asks
 * the server for an order (scoped to this client's own invoice); when checkout
 * closes, the result is sent back to be signature-checked — but **that does
 * not mark the invoice paid**. The webhook does, because a browser callback can
 * be forged, and a genuine one is lost the moment someone closes the tab
 * (CLAUDE.md 11). So the message here says the payment is confirming, and the
 * row updates when the gateway's webhook lands.
 */

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description: string;
  handler: (response: Record<string, string>) => void;
  modal: { ondismiss: () => void };
  prefill?: { name?: string; email?: string };
};

// The checkout script defines a global constructor; this is the shape we use of
// it. Typed narrowly rather than `any` (CLAUDE.md 2 rule 9).
type RazorpayConstructor = new (options: RazorpayOptions) => {
  open: () => void;
  on: (event: string, handler: (payload: unknown) => void) => void;
};

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

function loadCheckout(): Promise<RazorpayConstructor> {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);

  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SRC}"]`);
    const script = existing ?? document.createElement("script");

    const done = () => {
      if (window.Razorpay) resolve(window.Razorpay);
      else reject(new Error("checkout unavailable"));
    };

    script.addEventListener("load", done, { once: true });
    script.addEventListener("error", () => reject(new Error("checkout unavailable")), {
      once: true,
    });

    if (!existing) {
      script.src = CHECKOUT_SRC;
      script.async = true;
      document.body.appendChild(script);
    }
  });
}

export function PayInvoiceButton({
  invoiceId,
  invoiceNumber,
  businessName,
}: {
  invoiceId: string;
  invoiceNumber: string;
  businessName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const pay = async () => {
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch("/api/payments/order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invoiceId }),
      });

      const order: unknown = await response.json();

      if (!response.ok) {
        const error =
          typeof order === "object" && order !== null && "error" in order
            ? String((order as { error: unknown }).error)
            : "That payment could not be started.";
        setMessage({ tone: "bad", text: error });
        setBusy(false);
        return;
      }

      const { orderId, amountMinor, currency, publicKey } = order as {
        orderId: string;
        amountMinor: number;
        currency: string;
        publicKey: string;
      };

      const Razorpay = await loadCheckout();

      const checkout = new Razorpay({
        key: publicKey,
        amount: amountMinor,
        currency,
        order_id: orderId,
        name: businessName,
        description: `Invoice ${invoiceNumber}`,
        handler: (result) => {
          void (async () => {
            const verified = await fetch("/api/payments/verify", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(result),
            });
            const body: unknown = await verified.json();
            const text =
              typeof body === "object" && body !== null && "message" in body
                ? String((body as { message: unknown }).message)
                : "Payment sent. Your invoice updates once the gateway confirms it.";
            const ok =
              typeof body === "object" && body !== null && "verified" in body
                ? Boolean((body as { verified: unknown }).verified)
                : false;

            setMessage({ tone: ok ? "ok" : "bad", text });
            setBusy(false);
            router.refresh();
          })();
        },
        modal: {
          ondismiss: () => {
            setBusy(false);
            setMessage({ tone: "bad", text: "Payment cancelled. Nothing was charged." });
          },
        },
      });

      // Left busy on purpose: the handler and the dismiss callback are what
      // clear it, once the checkout window is actually gone.
      checkout.open();
    } catch {
      setMessage({
        tone: "bad",
        text: "The payment window could not be opened. Check your connection and try again.",
      });
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" disabled={busy} onClick={() => void pay()}>
        {busy ? "Opening…" : "Pay now"}
      </Button>
      {message ? (
        <p
          role={message.tone === "ok" ? "status" : "alert"}
          className={`max-w-60 text-right text-2xs ${
            message.tone === "ok" ? "text-success" : "text-brand-red"
          }`}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
