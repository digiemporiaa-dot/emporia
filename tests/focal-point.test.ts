import { describe, expect, it } from "vitest";
import { focalStyle } from "@/components/website/blocks-shared";

/**
 * The focal point, and who wins when two things want to say where an image sits.
 */

describe("focalStyle", () => {
  it("anchors a cropped image at the point chosen on the file", () => {
    expect(focalStyle({ focalX: 30, focalY: 70 })).toEqual({ objectPosition: "30% 70%" });
  });

  it("says nothing for a file with no focal point", () => {
    // Centre is what every image did before this existed, and it is the
    // browser's default — so the right answer is no style at all, not "50% 50%".
    expect(focalStyle({ focalX: null, focalY: null })).toBeUndefined();
  });

  it("says nothing when only one axis is set", () => {
    // Half a coordinate is a coordinate nobody chose.
    expect(focalStyle({ focalX: 40, focalY: null })).toBeUndefined();
    expect(focalStyle({ focalX: null, focalY: 40 })).toBeUndefined();
  });

  it("yields to a band that asked for a particular edge", () => {
    // Reaching for "align top" on one band is a decision about that band.
    expect(focalStyle({ focalX: 30, focalY: 70 }, "top")).toBeUndefined();
  });

  it("applies under the default position, which is what leaving it alone means", () => {
    expect(focalStyle({ focalX: 30, focalY: 70 }, "center")).toEqual({
      objectPosition: "30% 70%",
    });
  });

  it("handles the extremes without producing a broken value", () => {
    expect(focalStyle({ focalX: 0, focalY: 0 })).toEqual({ objectPosition: "0% 0%" });
    expect(focalStyle({ focalX: 100, focalY: 100 })).toEqual({ objectPosition: "100% 100%" });
  });
});
