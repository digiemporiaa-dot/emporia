import type { Metadata, Viewport } from "next";
import { Inter, Sora } from "next/font/google";
import "./globals.css";

/**
 * Typography is a primary design element, not an afterthought (CLAUDE.md 6):
 * a display face for headlines, a highly readable face for body copy. Both are
 * exposed as CSS variables that app/globals.css consumes, so swapping a
 * typeface is a change in this file alone.
 */
const display = Sora({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display-face",
  display: "swap",
});

const body = Inter({
  subsets: ["latin"],
  variable: "--font-body-face",
  display: "swap",
});

/**
 * Root metadata is a floor, not a policy. It carries no robots directive: the
 * public site sets its own per page through lib/seo, and the private surfaces
 * (admin, portal, auth) set noindex in their own layouts. A blanket noindex
 * here would silently deindex the marketing site.
 */
export const metadata: Metadata = {
  title: {
    default: "Emporia",
    template: "%s · Emporia",
  },
  description: "Digital marketing agency operating system.",
};

export const viewport: Viewport = {
  themeColor: "#002a3a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
