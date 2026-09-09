"use client";

import * as React from "react";

/**
 * Whether this component is alive in the browser yet.
 *
 * Needed by any form whose submission is a `fetch` rather than a post, or which
 * carries part of its content as JSON only React writes. React's progressive
 * enhancement will happily submit such a form before hydration: a `fetch`
 * handler that has not attached yet means the browser does its own native
 * submit, which reloads the page and throws away everything typed — and a
 * hidden JSON field posts whatever the server rendered.
 *
 * Gating the submit button on this is the fix. A form built entirely from
 * ordinary named inputs posting to a server action does not need it, and should
 * not use it: those work correctly with no JavaScript at all.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = React.useState(false);
  React.useEffect(() => setHydrated(true), []);
  return hydrated;
}
