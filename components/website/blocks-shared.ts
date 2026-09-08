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
};

export type BlockImages = Readonly<Record<string, BlockImage>>;
