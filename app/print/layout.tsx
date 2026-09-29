import type { Metadata } from "next";

/**
 * Printable documents, outside the admin and portal chrome so a printout is
 * the document and nothing else. Each page authenticates for itself; nothing
 * here is public, so nothing here is indexed.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="mx-auto max-w-4xl bg-white px-6 py-8 print:max-w-none print:px-0 print:py-0">
      {children}
    </main>
  );
}
