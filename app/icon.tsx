import { ImageResponse } from "next/og";

/**
 * The favicon, drawn rather than shipped as a binary.
 *
 * Generated from the two brand colours (CLAUDE.md 6) so it cannot drift from
 * the design system the way a checked-in .ico silently does, and so rebranding
 * stays a change to the tokens plus this one file. Next renders it once and
 * caches it; nothing is drawn per request.
 *
 * 32px is the size browsers actually use in a tab. Below that the mark stops
 * being legible, which is why there is a separate, simpler apple-icon.
 */
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#002a3a",
          color: "#ffffff",
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: -1,
          // Red is the accent, never the ground (CLAUDE.md 6).
          borderBottom: "3px solid #df1f38",
        }}
      >
        E
      </div>
    ),
    size,
  );
}
