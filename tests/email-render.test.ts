import { describe, expect, it } from "vitest";
import { escapeHtml, htmlToText, missingVariables, placeholdersIn, render } from "@/lib/email/render";
import { DEFAULT_TEMPLATES, GLOBAL_VARIABLES } from "@/lib/email/templates";
import { placeholdersIn as placeholders } from "@/lib/email/render";

/** Template rendering, and the defaults being internally consistent. */

describe("rendering", () => {
  it("substitutes what it is given", () => {
    expect(render("Hello {{name}}", { name: "Asha" })).toBe("Hello Asha");
    expect(render("{{a}}-{{b}}", { a: "1", b: "2" })).toBe("1-2");
    expect(render("{{ spaced }}", { spaced: "ok" })).toBe("ok");
  });

  it("escapes values, because they come from outside", () => {
    // A lead types this into the public contact form.
    const message = '<script>alert("x")</script>';
    const out = render("<p>{{message}}</p>", { message });

    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("escapes quotes and ampersands too", () => {
    expect(escapeHtml('A & B "c" <d>')).toBe("A &amp; B &quot;c&quot; &lt;d&gt;");
    expect(render("{{v}}", { v: "it\'s" })).toBe("it&#39;s");
  });

  it("does not escape the plain-text part, where escaping is wrong", () => {
    expect(render("{{v}}", { v: "Bell & Co" }, { escape: false })).toBe("Bell & Co");
  });

  it("leaves an unknown placeholder visible rather than blanking it", () => {
    // A silently empty sentence is harder to notice than a visible bug.
    expect(render("Hello {{name}}", {})).toBe("Hello {{name}}");
  });

  it("lists the placeholders a template uses", () => {
    expect(placeholdersIn("{{a}} {{b}} {{a}}")).toEqual(["a", "b"]);
    expect(placeholders("nothing here")).toEqual([]);
  });

  it("reports what a caller failed to supply", () => {
    expect(missingVariables("{{a}} {{b}}", { a: "1" })).toEqual(["b"]);
    expect(missingVariables("{{a}}", { a: "" })).toEqual([]);
  });
});

describe("html to text", () => {
  it("keeps link targets", () => {
    expect(htmlToText('<p>Read it <a href="https://x.test/p">here</a></p>')).toBe(
      "Read it here (https://x.test/p)",
    );
  });

  it("turns blocks into lines and drops the rest", () => {
    const text = htmlToText("<div><h1>Title</h1><p>One</p><p>Two</p></div>");
    expect(text).toBe("Title\nOne\nTwo");
  });

  it("unescapes entities", () => {
    expect(htmlToText("<p>Bell &amp; Co</p>")).toBe("Bell & Co");
  });

  it("drops style blocks entirely", () => {
    expect(htmlToText("<style>p{color:red}</style><p>Hi</p>")).toBe("Hi");
  });
});

describe("the default templates", () => {
  it("covers every key the build plan lists", () => {
    expect(DEFAULT_TEMPLATES.map((t) => t.key).sort()).toEqual(
      [
        "CLIENT_NOTIFICATION",
        "FOLLOW_UP",
        "INVOICE_SENT",
        "LEAD_ASSIGNED",
        "NEW_LEAD",
        "PASSWORD_RESET",
        "PAYMENT_RECEIVED",
        "PAYMENT_REMINDER",
        "PROPOSAL_ACCEPTED",
        "PROPOSAL_SENT",
        "STAFF_INVITATION",
      ].sort(),
    );
  });

  it("declares every variable it uses, and uses every one it declares", () => {
    for (const template of DEFAULT_TEMPLATES) {
      const known = new Set([
        ...Object.keys(template.variables),
        ...Object.keys(GLOBAL_VARIABLES),
      ]);

      const used = new Set([
        ...placeholdersIn(template.subject),
        ...placeholdersIn(template.html),
        ...placeholdersIn(template.text),
      ]);

      const undeclared = [...used].filter((name) => !known.has(name));
      expect(undeclared, `${template.key} uses undeclared ${undeclared.join(", ")}`).toEqual([]);

      const unused = Object.keys(template.variables).filter((name) => !used.has(name));
      expect(unused, `${template.key} declares unused ${unused.join(", ")}`).toEqual([]);
    }
  });

  it("renders with no placeholder left behind", () => {
    for (const template of DEFAULT_TEMPLATES) {
      const variables = Object.fromEntries(
        [...Object.keys(template.variables), ...Object.keys(GLOBAL_VARIABLES)].map((name) => [
          name,
          `value-${name}`,
        ]),
      );

      const subject = render(template.subject, variables);
      const html = render(template.html, variables);
      const text = render(template.text, variables, { escape: false });

      expect(subject, `${template.key} subject`).not.toMatch(/\{\{/);
      expect(html, `${template.key} html`).not.toMatch(/\{\{/);
      expect(text, `${template.key} text`).not.toMatch(/\{\{/);
    }
  });

  it("has a plain-text part for every template", () => {
    for (const template of DEFAULT_TEMPLATES) {
      expect(template.text.length, template.key).toBeGreaterThan(20);
    }
  });

  it("uses no external resources, which mail clients block anyway", () => {
    for (const template of DEFAULT_TEMPLATES) {
      expect(template.html, template.key).not.toMatch(/<img|<link|<script|@import/i);
    }
  });
});
