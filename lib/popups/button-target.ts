/**
 * A button that opens a popup instead of going to a page.
 *
 * Stored in the same field as a link — `popup:<popupId>` instead of `/path` —
 * so every block and the header keep one "where does this button go" value.
 * Shared by the zod schemas, the renderers and the builder; pure.
 */

export const POPUP_TARGET_PREFIX = "popup:";
const ID = /^[a-z0-9]{8,40}$/;

/** The popup id a button opens, or null when it is an ordinary link. */
export function popupTargetId(href: string | null | undefined): string | null {
  if (!href || !href.startsWith(POPUP_TARGET_PREFIX)) return null;
  const id = href.slice(POPUP_TARGET_PREFIX.length);
  return ID.test(id) ? id : null;
}

export function popupTarget(popupId: string): string {
  return `${POPUP_TARGET_PREFIX}${popupId}`;
}

export const isPopupTarget = (href: string | null | undefined) => popupTargetId(href) !== null;
