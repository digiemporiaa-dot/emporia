import { describe, expect, it } from "vitest";
import { contactFormSchema } from "@/lib/validation/lead";

const valid = {
  name: "Ananya Verma",
  email: "Ananya.Verma@Example.com",
  phone: "+91 98765 43210",
  company: "Verma Interiors",
  serviceId: "",
  message: "We need help attributing revenue to our paid search spend.",
  website: "",
};

describe("contact form validation", () => {
  it("accepts a well-formed enquiry", () => {
    const result = contactFormSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("normalises the email to lower case", () => {
    const result = contactFormSchema.parse(valid);
    expect(result.email).toBe("ananya.verma@example.com");
  });

  it("trims surrounding whitespace", () => {
    const result = contactFormSchema.parse({ ...valid, name: "  Ananya Verma  " });
    expect(result.name).toBe("Ananya Verma");
  });

  it("rejects a malformed email", () => {
    expect(contactFormSchema.safeParse({ ...valid, email: "not-an-email" }).success).toBe(false);
  });

  it("rejects a message that says nothing", () => {
    expect(contactFormSchema.safeParse({ ...valid, message: "hi" }).success).toBe(false);
  });

  it("rejects an over-long message rather than truncating it", () => {
    const result = contactFormSchema.safeParse({ ...valid, message: "x".repeat(4001) });
    expect(result.success).toBe(false);
  });

  it("accepts an omitted phone but rejects a malformed one", () => {
    expect(contactFormSchema.safeParse({ ...valid, phone: "" }).success).toBe(true);
    expect(contactFormSchema.safeParse({ ...valid, phone: "abc" }).success).toBe(false);
  });

  it("rejects unknown fields, so a caller cannot smuggle in extra data", () => {
    const result = contactFormSchema.safeParse({ ...valid, status: "WON", score: 100 });
    expect(result.success).toBe(false);
  });

  it("has no attribution fields at all — those are read server-side only", () => {
    const result = contactFormSchema.safeParse({
      ...valid,
      utmSource: "google",
      referrer: "https://evil.example",
    });
    expect(result.success).toBe(false);
  });

  it("treats a filled honeypot as invalid input", () => {
    expect(contactFormSchema.safeParse({ ...valid, website: "http://spam" }).success).toBe(false);
  });
});
