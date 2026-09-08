import * as React from "react";
import { Container } from "@/components/website/primitives";
import { resolveBand, type BandDefaults, type Presentation } from "@/lib/content/presentation";
import type { BlockImages } from "@/components/website/blocks-shared";
import { cn } from "@/lib/utils/cn";

/**
 * The frame every page-builder block renders through.
 *
 * It owns the things an editor controls at section level — width, spacing,
 * alignment, background, overlay, border, radius — so a block renderer is only
 * ever concerned with its own contents. Adding a control here reaches every
 * block at once, rather than fourteen renderers each growing their own.
 *
 * The defaults each block passes reproduce the padding and width it had before
 * this existed, so a section with no `band` produces the same markup it always
 * did: the whole existing site is unchanged until someone opens the Layout tab
 * (CLAUDE.md 2 rule 10).
 *
 * A server component. Nothing here is interactive, and none of these controls
 * need JavaScript — CSS Grid and Tailwind breakpoints do the responsive work,
 * so a page arrives correct in the first paint (CLAUDE.md 12, performance).
 */

export function Band({
  band,
  defaults,
  images = {},
  className,
  contentClassName,
  as: Tag = "section",
  children,
}: {
  band?: Presentation | undefined;
  defaults: BandDefaults;
  images?: BlockImages;
  className?: string | undefined;
  contentClassName?: string | undefined;
  as?: "section" | "div" | "header";
  children: React.ReactNode;
}) {
  const backgroundId = band?.background?.mediaId;
  const backgroundUrl = backgroundId ? images[backgroundId]?.url : undefined;
  const resolved = resolveBand(band, defaults, backgroundUrl);

  // `relative` is only needed to sit content above a painted background, and
  // an unconditional wrapper div per block is markup nobody asked for. Both are
  // added only when this band actually paints something.
  const paints = Object.keys(resolved.outerStyle).length > 0 || Boolean(resolved.overlayStyle);
  const inner = cn(resolved.contentClassName, contentClassName, paints && "relative");

  return (
    <Tag
      className={cn(resolved.outerClassName, className) || undefined}
      style={resolved.outerStyle}
    >
      {resolved.overlayStyle ? (
        // Painted between the image and the content, never over it: the
        // overlay is decoration, so it is hidden from assistive technology and
        // cannot intercept a click on a link beneath it.
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={resolved.overlayStyle}
        />
      ) : null}
      {resolved.containerWidth === null ? (
        <div className={inner || undefined}>{children}</div>
      ) : (
        <Container width={resolved.containerWidth} className={inner}>
          {children}
        </Container>
      )}
    </Tag>
  );
}

/**
 * Text colours for a band that may be inverted.
 *
 * A dark background flips the whole palette, and the alternative — every
 * renderer growing its own `inverted ? … : …` ternaries — is how a section ends
 * up with white headings on a white card. One place decides.
 */
export function bandInverted(band: Presentation | undefined, backgroundUrl?: string): boolean {
  return resolveBand(
    band,
    { paddingTop: "none", paddingBottom: "none", container: "default" },
    backgroundUrl,
  ).inverted;
}
