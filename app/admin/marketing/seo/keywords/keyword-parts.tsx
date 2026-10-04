import type { Movement } from "@/lib/seo-intel/engine/rankings";

/** Movement as text plus an arrow, so it never relies on colour alone. */
export function ChangeCell({ movement }: { movement: Movement }) {
  if (movement.status === "new") return <span className="text-2xs text-ink-muted">New</span>;
  if (movement.status === "lost") return <span className="text-2xs text-brand-red-text">Lost</span>;
  if (movement.change === null) return <span className="text-ink-subtle">—</span>;
  if (movement.status === "steady") return <span className="text-2xs text-ink-subtle">Steady</span>;
  const up = movement.change > 0;
  return (
    <span className={`tabular-nums text-xs ${up ? "text-success" : "text-brand-red-text"}`}>
      <span aria-hidden="true">{up ? "▲" : "▼"} </span>
      <span className="sr-only">{up ? "Up" : "Down"} </span>
      {Math.abs(movement.change).toFixed(1)}
    </span>
  );
}

export const formatPos = (position: number | null, impressions: number) => (impressions > 0 && position !== null ? position.toFixed(1) : "—");
export const formatCtr = (clicks: number, impressions: number) => (impressions > 0 ? `${((clicks / impressions) * 100).toFixed(1)}%` : "—");

const BAND_LABEL = { top3: "top 3", top10: "top 10", top20: "top 20" } as const;

export function BandNote({ movement }: { movement: Movement }) {
  if (movement.entered && movement.entered in BAND_LABEL) {
    return <span className="block text-2xs text-success">Entered {BAND_LABEL[movement.entered as keyof typeof BAND_LABEL]}</span>;
  }
  if (movement.left && movement.left in BAND_LABEL) {
    return <span className="block text-2xs text-brand-red-text">Left {BAND_LABEL[movement.left as keyof typeof BAND_LABEL]}</span>;
  }
  return null;
}
