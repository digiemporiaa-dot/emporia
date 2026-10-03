import { describe, expect, it } from "vitest";
import {
  assertSafeUrl,
  hostProblem,
  isPublicAddress,
  parseSiteInput,
  resolvePublicHost,
  UnsafeTargetError,
  type Lookup,
} from "@/lib/seo-intel/net/safe-url";

/**
 * What SEO Intelligence may fetch. The crawler (Phase 3) builds on this, so
 * the SSRF rules are pinned before anything can reach the network.
 */

describe("a website typed into the form", () => {
  it.each([
    ["example.com", { domain: "example.com", protocol: null }],
    ["  Example.COM  ", { domain: "example.com", protocol: null }],
    ["https://www.example.com/", { domain: "www.example.com", protocol: "HTTPS" }],
    ["http://shop.example.co.uk/some/page?x=1", { domain: "shop.example.co.uk", protocol: "HTTP" }],
    ["example.com.", { domain: "example.com", protocol: null }],
    ["bücher.example", null],
    ["münchen.de", { domain: "xn--mnchen-3ya.de", protocol: null }],
  ])("%s", (input, expected) => {
    if (expected === null) expect(() => parseSiteInput(input)).toThrow(UnsafeTargetError);
    else expect(parseSiteInput(input)).toEqual(expected);
  });

  it.each([
    ["", /Enter a domain/],
    ["exa mple.com", /spaces/],
    ["localhost", /full domain|reserved/],
    ["intranet", /full domain/],
    ["db.internal", /reserved/],
    ["printer.local", /reserved/],
    ["router.home.arpa", /reserved/],
    ["site.test", /reserved/],
    ["127.0.0.1", /not an IP address/],
    ["http://10.0.0.5/", /not an IP address/],
    ["http://[::1]/", /not an IP address/],
    ["http://2130706433/", /not an IP address/],
    ["http://0x7f000001/", /not an IP address/],
    ["ftp://example.com", /http/],
    ["javascript:alert(1)", /http/],
    ["file:///etc/passwd", /http/],
    ["https://user:pass@example.com", /user name or password/],
    ["example.com:8080", /non-standard port/],
    ["https://example.com:6379/", /non-standard port/],
    ["-bad.example.com", /not a valid/],
    ["example.123", /not a valid/],
  ])("refuses %s", (input, message) => {
    expect(() => parseSiteInput(input)).toThrow(message);
  });
});

describe("host names", () => {
  it("accepts an ordinary public name", () => {
    expect(hostProblem("www.digiemporia.com")).toBeNull();
  });

  it("refuses a name longer than DNS allows", () => {
    expect(hostProblem(`${"a".repeat(60)}.`.repeat(5) + "com")).toMatch(/too long/);
  });

  it("refuses a label over 63 characters", () => {
    expect(hostProblem(`${"a".repeat(64)}.com`)).toMatch(/not a valid/);
  });
});

describe("URLs the crawler may request", () => {
  it("allows http(s) on the default ports", () => {
    expect(assertSafeUrl("https://example.com:443/a").hostname).toBe("example.com");
    expect(assertSafeUrl("http://example.com:80/a").hostname).toBe("example.com");
  });

  it.each([
    "https://example.com:8443/",
    "http://example.com:443/",
    "gopher://example.com/",
    "http://admin:x@example.com/",
    "http://169.254.169.254/latest/meta-data/",
    "http://metadata.google.internal/",
    "http://localhost/",
    "not a url",
  ])("refuses %s", (url) => {
    expect(() => assertSafeUrl(url)).toThrow(UnsafeTargetError);
  });
});

describe("addresses", () => {
  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "142.250.183.14",
    "2607:f8b0:4004:c07::64",
    "2a00:1450:4001:82a::200e",
    "2001:4860:4860::8888",
  ])("%s is public", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "127.255.255.254",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "203.0.113.9",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
    "2002:7f00:1::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:10.0.0.1",
    "64:ff9b::a9fe:a9fe",
    "64:ff9b::169.254.169.254",
    "not-an-ip",
  ])("%s is not public", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it("a mapped public address is public", () => {
    expect(isPublicAddress("::ffff:8.8.8.8")).toBe(true);
  });

  it("172.15 and 172.32 are outside the private /12", () => {
    expect(isPublicAddress("172.15.255.255")).toBe(true);
    expect(isPublicAddress("172.32.0.0")).toBe(true);
  });
});

describe("resolving a host before fetching it", () => {
  const answers =
    (...addresses: string[]): Lookup =>
    async () =>
      addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

  it("returns the public addresses to connect to", async () => {
    await expect(resolvePublicHost("example.com", answers("93.184.215.14", "2606:2800:21f:cb07:6820:80da:af6b:8b2c"))).resolves.toEqual([
      "93.184.215.14",
      "2606:2800:21f:cb07:6820:80da:af6b:8b2c",
    ]);
  });

  it("refuses a public-looking name that points inside", async () => {
    await expect(resolvePublicHost("evil.example.com", answers("127.0.0.1"))).rejects.toThrow(/private or reserved/);
  });

  it("refuses when any one answer is private, not only the first", async () => {
    await expect(resolvePublicHost("mixed.example.com", answers("93.184.215.14", "10.0.0.7"))).rejects.toThrow(/private or reserved/);
  });

  it("refuses the cloud metadata address", async () => {
    await expect(resolvePublicHost("meta.example.com", answers("169.254.169.254"))).rejects.toThrow(UnsafeTargetError);
  });

  it("says when the name does not resolve", async () => {
    await expect(resolvePublicHost("nowhere.example.com", answers())).rejects.toThrow(/could not be found/);
    const failing: Lookup = async () => {
      throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
    };
    await expect(resolvePublicHost("nowhere.example.com", failing)).rejects.toThrow(/could not be found/);
  });

  it("never looks up a name that is unsafe by its spelling", async () => {
    let asked = false;
    const spy: Lookup = async () => {
      asked = true;
      return [{ address: "8.8.8.8", family: 4 }];
    };
    await expect(resolvePublicHost("localhost", spy)).rejects.toThrow(UnsafeTargetError);
    expect(asked).toBe(false);
  });
});
