"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui";
import { RANGE_LABEL, RANGE_PRESETS } from "@/lib/analytics/range";

/**
 * The analytics period. Its own component, above the figures' Suspense
 * boundary, so it stays usable while a new period's figures load.
 */
export function PeriodSelect({ clientId, range }: { clientId: string; range: string }) {
  const router = useRouter();
  return (
    <label className="block">
      <span className="mb-1.5 block text-2xs font-medium uppercase tracking-wide text-ink-subtle">Period</span>
      <Select
        className="w-48"
        value={range}
        onChange={(event) => router.push(`/admin/clients/${clientId}/social/analytics?range=${event.target.value}` as Route)}
      >
        {RANGE_PRESETS.map((preset) => (
          <option key={preset} value={preset}>
            {RANGE_LABEL[preset]}
          </option>
        ))}
      </Select>
    </label>
  );
}
