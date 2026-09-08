import * as React from "react";
import Link from "next/link";
import type { Route } from "next";

/**
 * One admin-managed navigation link.
 *
 * Internal paths go through `next/link` so they prefetch and navigate client
 * side; anything with a scheme is a plain anchor, because `Link` has nothing to
 * prefetch on another origin. The destination has already been through
 * `navHref` in lib/validation/navigation, so only `/path`, `#anchor`,
 * `http(s)://`, `mailto:` and `tel:` can reach here.
 *
 * No hooks: the footer is a server component, and the header's active state is
 * decided by the header itself.
 */

export function isExternalHref(href: string): boolean {
  return /^(https?:\/\/|mailto:|tel:)/i.test(href);
}

export type NavLinkProps = {
  href: string;
  newTab?: boolean;
  className?: string;
  "aria-current"?: React.AriaAttributes["aria-current"];
  children: React.ReactNode;
};

export function NavLink({ href, newTab, children, ...rest }: NavLinkProps) {
  const target = newTab ? "_blank" : undefined;
  // `rel` is not optional on a new-tab link: without `noopener` the opened page
  // gets a handle on this one through `window.opener`.
  const rel = newTab ? "noopener noreferrer" : undefined;

  if (isExternalHref(href) || href.startsWith("#")) {
    return (
      <a href={href} target={target} rel={rel} {...rest}>
        {children}
      </a>
    );
  }

  return (
    // typedRoutes cannot check a string that comes out of the database. The
    // validation layer guarantees the shape (`/…`); a path that matches no
    // route renders the site's not-found page, which is the correct outcome for
    // a link an editor pointed at a page they have not published yet.
    <Link href={href as Route} target={target} rel={rel} {...rest}>
      {children}
    </Link>
  );
}
