import { ImageResponse } from "next/og";

/**
 * The home-screen icon.
 *
 * Separate from the favicon because iOS renders it at 180px on a rounded tile
 * of its own: the 32px mark's hairline rule would be lost, so this one carries
 * the accent as a wider bar and more breathing room.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
          fontSize: 104,
          fontWeight: 700,
          letterSpacing: -4,
          borderBottom: "14px solid #df1f38",
        }}
      >
        E
      </div>
    ),
    size,
  );
}
