import { describe, expect, it } from "vitest";
import { videoEmbedUrl, videoId } from "@/lib/content/video";

/**
 * Video embeds.
 *
 * The block accepts a URL or an id and builds the iframe itself; there is no
 * field that takes markup. What matters here is that nothing but a validated id
 * can influence the `src`, so the cases below are mostly about what is
 * rejected.
 */

describe("videoId", () => {
  it("reads a YouTube id out of every URL shape people paste", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
      "dQw4w9WgXcQ",
    ]) {
      expect(videoId("youtube", url), url).toBe("dQw4w9WgXcQ");
    }
  });

  it("reads a Vimeo id out of its URL shapes", () => {
    expect(videoId("vimeo", "https://vimeo.com/123456789")).toBe("123456789");
    expect(videoId("vimeo", "https://player.vimeo.com/video/123456789")).toBe("123456789");
    expect(videoId("vimeo", "123456789")).toBe("123456789");
  });

  it("refuses a URL on a host we do not embed", () => {
    // The id is genuine; the host is not. Searching the string for something
    // id-shaped would have accepted this.
    expect(videoId("youtube", "https://evil.example/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(videoId("vimeo", "https://evil.example/123456789")).toBeNull();
  });

  it("refuses a provider mismatch", () => {
    expect(videoId("vimeo", "https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(videoId("youtube", "https://vimeo.com/123456789")).toBeNull();
  });

  it("refuses anything that is not http(s)", () => {
    expect(videoId("youtube", "javascript:alert(1)")).toBeNull();
    expect(videoId("youtube", "data:text/html,<script>")).toBeNull();
  });

  it("refuses an id of the wrong shape", () => {
    expect(videoId("youtube", "tooshort")).toBeNull();
    expect(videoId("youtube", "way-too-long-for-youtube")).toBeNull();
    expect(videoId("vimeo", "notdigits")).toBeNull();
    expect(videoId("youtube", "")).toBeNull();
  });
});

describe("videoEmbedUrl", () => {
  it("builds the embed from the id alone", () => {
    expect(videoEmbedUrl("youtube", "dQw4w9WgXcQ")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
    expect(videoEmbedUrl("vimeo", "123456789")).toBe("https://player.vimeo.com/video/123456789");
  });

  it("refuses to build one from an id that never passed validation", () => {
    expect(videoEmbedUrl("youtube", "../../evil")).toBeNull();
    expect(videoEmbedUrl("youtube", 'x" onload="alert(1)')).toBeNull();
  });
});
