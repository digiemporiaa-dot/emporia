/**
 * Types shared between the block renderers and the frame they render through.
 *
 * Their own module so `band.tsx` can name an image without importing
 * `blocks.tsx`, which imports the band — a cycle that would otherwise only
 * surface as an undefined component at render time.
 */

export type BlockImage = {
  id: string;
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  /** Focal point, whole percentages of width and height. Null means centre. */
  focalX: number | null;
  focalY: number | null;
  /** Default caption, used by blocks that show one and have none of their own. */
  caption: string | null;
};

export type BlockImages = Readonly<Record<string, BlockImage>>;

/**
 * Where a cropped image should stay anchored.
 *
 * Only meaningful where the frame actually crops — a fixed aspect ratio with
 * `object-cover`. An image rendered at its own height loses nothing, so there
 * is nothing to choose.
 *
 * The band's own position token wins when it is set to anything but `center`:
 * the file's focal point is a default for "wherever this picture is cropped",
 * and an editor who reached for "align top" on this one band meant this one
 * band. `center` is the token's default value, so leaving it alone is what lets
 * the file's own point through.
 *
 * Returned as an inline style rather than a class because the coordinates are
 * arbitrary percentages: an interpolated Tailwind class is invisible to the
 * scanner and would silently produce no CSS at all.
 */
export function focalStyle(
  image: Pick<BlockImage, "focalX" | "focalY">,
  position = "center",
): { objectPosition: string } | undefined {
  if (position !== "center") return undefined;
  if (image.focalX === null || image.focalY === null) return undefined;
  return { objectPosition: `${image.focalX}% ${image.focalY}%` };
}
