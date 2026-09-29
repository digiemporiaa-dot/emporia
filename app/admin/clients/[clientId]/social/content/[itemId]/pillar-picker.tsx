"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Select, useToast } from "@/components/ui";
import { setContentPillarAction } from "../actions";

/**
 * Which pillar this idea serves. The only interactive part of the idea's
 * header, so it is the only part that is a client component.
 */
export function PillarPicker({
  clientId,
  itemId,
  value,
  pillars,
  canEdit,
}: {
  clientId: string;
  itemId: string;
  value: string | null;
  pillars: readonly { id: string; name: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = React.useTransition();

  return (
    <label className="inline-flex items-center gap-2 text-xs text-ink-subtle">
      Pillar
      <Select
        className="h-8 w-48 text-xs"
        value={value ?? ""}
        disabled={!canEdit || pending}
        onChange={(event) => {
          const pillarId = event.target.value || null;
          start(async () => {
            const result = await setContentPillarAction({ clientId, itemId, pillarId });
            if (!result.ok) {
              push({ tone: "error", title: "That did not work.", description: result.message });
              return;
            }
            router.refresh();
          });
        }}
      >
        <option value="">No pillar</option>
        {pillars.map((pillar) => (
          <option key={pillar.id} value={pillar.id}>
            {pillar.name}
          </option>
        ))}
      </Select>
    </label>
  );
}
