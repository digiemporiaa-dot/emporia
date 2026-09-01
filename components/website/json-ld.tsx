import * as React from "react";

/**
 * Renders JSON-LD.
 *
 * Nulls are filtered out, so a caller can pass the result of an emitter that
 * declined to produce schema (an FAQPage with no questions, say) without
 * guarding at every call site.
 *
 * `JSON.stringify` output is escaped for `<` so a string in the data cannot
 * close the script tag early.
 */
export function JsonLd({ schema }: { schema: object | null | (object | null)[] }) {
  const items = (Array.isArray(schema) ? schema : [schema]).filter(
    (item): item is object => item !== null,
  );

  if (items.length === 0) return null;

  return (
    <>
      {items.map((item, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(item).replace(/</g, "\\u003c"),
          }}
        />
      ))}
    </>
  );
}
