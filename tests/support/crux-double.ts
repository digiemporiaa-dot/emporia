import type { CruxFormFactor, CruxProvider, CruxRecord, CruxTarget } from "@/lib/seo-intel/providers/crux";

/**
 * An in-memory Chrome UX Report: records and history keyed by origin or URL
 * and form factor. Anything not set answers as Google does for too little
 * traffic — no record. Every call is logged.
 */
export type CruxDouble = CruxProvider & {
  calls: { kind: "record" | "history"; key: string; formFactor: CruxFormFactor }[];
  set: (key: string, formFactor: CruxFormFactor, record: CruxRecord) => void;
  setHistory: (key: string, formFactor: CruxFormFactor, records: CruxRecord[]) => void;
  failWith: (error: Error | null) => void;
};

export function cruxDouble(): CruxDouble {
  const records = new Map<string, CruxRecord>();
  const histories = new Map<string, CruxRecord[]>();
  const calls: CruxDouble["calls"] = [];
  let failure: Error | null = null;
  const keyOf = (target: CruxTarget) => ("origin" in target ? target.origin : target.url);
  return {
    calls,
    set: (key, formFactor, record) => void records.set(`${key}|${formFactor}`, record),
    setHistory: (key, formFactor, list) => void histories.set(`${key}|${formFactor}`, list),
    failWith: (error) => {
      failure = error;
    },
    async record(target, formFactor) {
      calls.push({ kind: "record", key: keyOf(target), formFactor });
      if (failure) throw failure;
      return records.get(`${keyOf(target)}|${formFactor}`) ?? null;
    },
    async history(target, formFactor) {
      calls.push({ kind: "history", key: keyOf(target), formFactor });
      if (failure) throw failure;
      return histories.get(`${keyOf(target)}|${formFactor}`) ?? [];
    },
  };
}
