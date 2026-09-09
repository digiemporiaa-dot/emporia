/**
 * Block content migrations.
 *
 * Section content is JSON validated against a schema at render time. That is
 * already safe — a row that no longer matches its schema is dropped rather than
 * rendered — but "safe" and "acceptable" are different things: a schema change
 * that renames or restructures a field would silently blank that band on every
 * page it appears on, and the only way back would be a database script.
 *
 * So content carries a `version`, and this is the ladder that brings an older
 * one forward. It runs on read, in memory, before validation:
 *
 *   stored v1  →  migrate  →  v2 shape  →  schema.parse  →  render
 *
 * Nothing here writes. A page is upgraded on disk the next time an editor saves
 * it, and until then it keeps rendering correctly from the migrated copy. That
 * ordering is deliberate: a read path that writes would turn opening a page in
 * a preview into a mutation, and a bad migration would then be permanent.
 *
 * ## Adding one
 *
 * 1. Bump `CURRENT_VERSION`.
 * 2. Add an entry to `MIGRATIONS` keyed by the version it upgrades *from*.
 * 3. Write it as a pure function over unknown content, defensive about shape —
 *    it runs against whatever is actually in the database, not against the type
 *    you wish were there.
 * 4. Test it with a real stored payload from before the change.
 *
 * Content with no `version` is treated as version 1: everything written before
 * this existed is that, by definition.
 */

export const CURRENT_VERSION = 1;

type Content = Record<string, unknown>;

/**
 * Keyed by the version being upgraded *from*. `MIGRATIONS[1]` turns a v1 body
 * into a v2 one.
 *
 * Empty today. The mechanism ships before the first schema change needs it,
 * because retrofitting it afterwards means the change that needed it has
 * already broken the pages.
 */
const MIGRATIONS: Record<number, (content: Content, type: string) => Content> = {};

export function contentVersion(content: unknown): number {
  if (!content || typeof content !== "object") return CURRENT_VERSION;
  const raw = (content as Content)["version"];
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) return 1;
  return raw;
}

/**
 * Bring one block's content up to the current version.
 *
 * Returns the input unchanged when it is already current, so the common path
 * allocates nothing. A version *newer* than this build understands is left
 * alone rather than mangled — that is a deployment running behind the database,
 * and the schema parse will decide whether it still renders.
 */
export function migrateContent(content: unknown, type: string): unknown {
  if (!content || typeof content !== "object" || Array.isArray(content)) return content;

  let version = contentVersion(content);
  if (version >= CURRENT_VERSION) return content;

  let current = { ...(content as Content) };
  while (version < CURRENT_VERSION) {
    const step = MIGRATIONS[version];
    // A gap in the ladder is a programming error, not a data error. Stopping
    // leaves the content at the last version that had a migration, which the
    // schema parse then judges — better than looping forever.
    if (!step) break;
    current = step(current, type);
    version += 1;
    current["version"] = version;
  }

  return current;
}

/**
 * Stamp parsed content with the version that produced it.
 *
 * Applied at the two places section content is written. Block schemas strip
 * unknown keys, so the version cannot live inside a block's own schema without
 * adding it to all thirty; stamping after the parse keeps the schemas about
 * content and this file about versioning. `migrateContent` reads it back off
 * the raw stored JSON, before any parse strips it again.
 */
export function stampVersion<T>(parsed: T): T & { version: number } {
  return { ...(parsed as object), version: CURRENT_VERSION } as T & { version: number };
}
