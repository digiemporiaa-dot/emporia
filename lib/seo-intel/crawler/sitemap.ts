import { Parser } from "htmlparser2";

/**
 * A sitemap or sitemap index. Both are read with one pass: `<url><loc>` are
 * pages, `<sitemap><loc>` are further sitemaps to read.
 */
export function parseSitemap(xml: string, maxUrls = 50_000): { urls: string[]; sitemaps: string[] } {
  const urls: string[] = [];
  const sitemaps: string[] = [];
  const stack: string[] = [];
  let text = "";

  const parser = new Parser(
    {
      onopentag(name) {
        stack.push(name.toLowerCase().replace(/^.*:/, ""));
        text = "";
      },
      ontext(chunk) {
        text += chunk;
      },
      onclosetag() {
        const name = stack.pop();
        if (name === "loc") {
          const parent = stack[stack.length - 1];
          const loc = text.trim();
          if (loc) {
            if (parent === "sitemap") sitemaps.push(loc);
            else if (parent === "url" && urls.length < maxUrls) urls.push(loc);
          }
        }
        text = "";
      },
    },
    { xmlMode: true, decodeEntities: true },
  );
  parser.write(xml);
  parser.end();
  return { urls, sitemaps };
}
