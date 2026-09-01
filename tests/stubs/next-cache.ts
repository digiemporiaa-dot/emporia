/**
 * Test stub for `next/cache`.
 *
 * `unstable_cache` and `revalidateTag` need a Next request/render context and
 * throw outside one, which would make every service that revalidates
 * untestable. The stub keeps the call sites real — the service still calls
 * revalidateTag — while making the cache a passthrough so tests observe the
 * database rather than a memoised value.
 */

export function unstable_cache<T extends (...args: never[]) => Promise<unknown>>(fn: T): T {
  return fn;
}

const revalidated: string[] = [];

export function revalidateTag(tag: string): void {
  revalidated.push(tag);
}

export function revalidatePath(path: string): void {
  revalidated.push(path);
}

/** Test helper: what the code under test asked to revalidate. */
export function __revalidated(): readonly string[] {
  return revalidated;
}

export function __clearRevalidated(): void {
  revalidated.length = 0;
}
