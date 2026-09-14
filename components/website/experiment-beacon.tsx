"use client";

import * as React from "react";

/**
 * Report that this visitor saw these arms.
 *
 * Fired after render, once per mount, and deliberately silent: a sample that
 * failed to record is a smaller sample, not a broken page. Nothing is displayed
 * and nothing blocks.
 *
 * The arms come from the server, which already decided them — the client is
 * only the messenger, and the route re-checks that the arm belongs to a running
 * experiment before counting it.
 */
export function ExperimentBeacon({
  arms,
}: {
  arms: readonly { experimentId: string; variantId: string }[];
}) {
  React.useEffect(() => {
    if (arms.length === 0) return;

    for (const arm of arms) {
      void fetch("/api/experiments/exposure", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(arm),
        keepalive: true,
      }).catch(() => undefined);
    }
    // Reported once per page view. The unique constraint on the server means a
    // reload costs a request and changes nothing, which is the correct
    // behaviour — the denominator is people, not page views.
  }, [arms]);

  return null;
}
