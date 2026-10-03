import type { Prisma } from "../../generated/prisma/client";
import { countryCodeForName, countryName, isCountryCode } from "./countries";

/**
 * `Country` rows, created when something first refers to them.
 *
 * Takes the client (or transaction) as an argument, so the same code runs in
 * a service, in a transaction and in the deploy-time platform sync.
 */

type Db = Pick<Prisma.TransactionClient, "country" | "city">;

/** The row for an ISO code, created if absent. Null when the code is not a country. */
export async function ensureCountry(db: Db, code: string): Promise<{ id: string; code: string } | null> {
  const upper = code.trim().toUpperCase();
  if (!isCountryCode(upper)) return null;
  return db.country.upsert({
    where: { code: upper },
    create: { code: upper, name: countryName(upper) ?? upper },
    update: {},
    select: { id: true, code: true },
  });
}

/** The row for a country *name* as typed on a city, or null when it is not recognised. */
export async function countryIdForName(db: Db, name: string): Promise<string | null> {
  const code = countryCodeForName(name);
  if (!code) return null;
  return (await ensureCountry(db, code))?.id ?? null;
}

/**
 * Link every city whose `countryId` is empty to the country its `country`
 * text names. Idempotent; a name nobody recognises is left unlinked and
 * reported, never guessed.
 */
export async function linkCityCountries(db: Db): Promise<{ linked: number; unrecognised: string[] }> {
  const pending = await db.city.findMany({
    where: { countryId: null },
    select: { id: true, country: true },
  });

  const byName = new Map<string, string[]>();
  for (const city of pending) {
    const ids = byName.get(city.country) ?? [];
    ids.push(city.id);
    byName.set(city.country, ids);
  }

  let linked = 0;
  const unrecognised: string[] = [];
  for (const [name, ids] of byName) {
    const countryId = await countryIdForName(db, name);
    if (!countryId) {
      unrecognised.push(name);
      continue;
    }
    const result = await db.city.updateMany({ where: { id: { in: ids }, countryId: null }, data: { countryId } });
    linked += result.count;
  }
  return { linked, unrecognised };
}
