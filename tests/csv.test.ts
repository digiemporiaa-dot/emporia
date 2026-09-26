import { describe, expect, it } from "vitest";
import { CsvError, normaliseHeader, parseCsv, readTable } from "@/lib/csv/parse";
import { toCsv } from "@/lib/csv/serialise";

/**
 * The CSV reader and writer.
 *
 * These are the cases that break a `split(",")`, which is what this replaced.
 * Each one is a file a spreadsheet produces without being asked to.
 */

describe("parseCsv", () => {
  it("reads plain rows", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps a comma inside a quoted field", () => {
    // The whole reason this module exists: any description, quote or answer.
    expect(parseCsv('a,b\n"one, two",3')).toEqual([
      ["a", "b"],
      ["one, two", "3"],
    ]);
  });

  it("keeps a newline inside a quoted field", () => {
    expect(parseCsv('a\n"line one\nline two"')).toEqual([["a"], ["line one\nline two"]]);
  });

  it("reads a doubled quote as one quote", () => {
    expect(parseCsv('a\n"He said ""yes"""')).toEqual([["a"], ['He said "yes"']]);
  });

  it("handles CRLF and a bare CR", () => {
    expect(parseCsv("a,b\r\n1,2\r3,4")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("does not invent a row for a trailing newline", () => {
    expect(parseCsv("a,b\n1,2\n")).toHaveLength(2);
  });

  it("strips the byte-order mark Excel writes", () => {
    // Left in, the first header reads "﻿slug" and matches no column.
    const [header] = parseCsv("﻿slug,name\nx,y");
    expect(header?.[0]).toBe("slug");
  });

  it("keeps empty cells rather than collapsing them", () => {
    expect(parseCsv("a,,c")).toEqual([["a", "", "c"]]);
  });

  it("treats a quote inside an unquoted field as text", () => {
    // `Rs 1,200 "all in"` is read by every spreadsheet; refusing it would
    // reject correct data.
    expect(parseCsv('a\nabout 6" tall')).toEqual([["a"], ['about 6" tall']]);
  });

  it("refuses an unclosed quote, and says which line opened it", () => {
    let caught: unknown;
    try {
      parseCsv('a\nb\n"never closed');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CsvError);
    expect((caught as CsvError).line).toBe(3);
  });
});

describe("readTable", () => {
  it("matches headers however they are spelt", () => {
    expect(normaliseHeader("Short description")).toBe(normaliseHeader("short_description"));
    expect(normaliseHeader("shortDescription")).toBe(normaliseHeader("Short-Description"));
  });

  it("reports the file line each row came from", () => {
    const table = readTable("slug,name\na,A\n\nb,B");
    expect(table.rows).toHaveLength(2);
    // Line 3 is the blank one, so the second row is line 4.
    expect(table.lineOf(0)).toBe(2);
    expect(table.lineOf(1)).toBe(4);
  });

  it("refuses two columns with the same name", () => {
    // Keeping the first would mean an edit to the second is silently ignored.
    expect(() => readTable("slug,name,slug\na,A,b")).toThrow(CsvError);
  });

  it("refuses an empty file", () => {
    expect(() => readTable("   \n\n")).toThrow(CsvError);
  });
});

describe("toCsv", () => {
  it("round-trips a value that needs quoting", () => {
    const csv = toCsv(["quote"], [['She said "it, worked"\nand left']]);
    expect(parseCsv(csv)[1]?.[0]).toBe('She said "it, worked"\nand left');
  });

  it("does not quote what does not need it", () => {
    expect(toCsv(["a", "b"], [["1", "2"]])).toBe("a,b\r\n1,2\r\n");
  });

  it("defuses a cell a spreadsheet would run as a formula", () => {
    // Opened in Excel, `=HYPERLINK(...)` in exported content is executed. The
    // tab keeps the text and stops that; it trims away on the way back in.
    const csv = toCsv(["quote"], [["=1+1"]]);
    expect(parseCsv(csv)[1]?.[0]).toBe("\t=1+1");
    expect((parseCsv(csv)[1]?.[0] as string).trim()).toBe("=1+1");
  });
});
