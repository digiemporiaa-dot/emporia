import { describe, expect, it, vi } from "vitest";
import {
  OAUTH_STATE_COOKIE,
  callbackUrl,
  issueState,
  readState,
} from "@/lib/social/oauth-state";

/**
 * The OAuth `state`.
 *
 * This is the piece that decides whether a client's Instagram can be connected
 * to an attacker's account. Two independent checks have to hold: our signature
 * (so the client id cannot be swapped) and the nonce cookie (so a signed state
 * cannot be replayed by whoever obtained it). Both are tested for failing
 * closed.
 */

const ISSUE = { clientId: "client-1", provider: "LINKEDIN" as const, returnTo: "/admin/clients/client-1/social/accounts" };

describe("oauth state", () => {
  it("round-trips the client it was issued for", () => {
    const { state, nonce } = issueState(ISSUE);
    const read = readState(state, nonce);

    expect(read.ok).toBe(true);
    expect(read.ok && read.value.clientId).toBe("client-1");
    expect(read.ok && read.value.provider).toBe("LINKEDIN");
  });

  it("refuses a state whose payload was edited", () => {
    // The whole point: swapping the client id must not survive.
    const { state, nonce } = issueState(ISSUE);
    const [body, signature] = state.split(".");
    const tampered = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(body as string, "base64url").toString("utf8")),
        clientId: "someone-elses-client",
      }),
      "utf8",
    ).toString("base64url");

    const read = readState(`${tampered}.${signature}`, nonce);
    expect(read).toEqual({ ok: false, reason: "signature" });
  });

  it("refuses a state signed with nothing", () => {
    const { nonce } = issueState(ISSUE);
    const forged = Buffer.from(JSON.stringify({ ...ISSUE, nonce, issuedAt: Date.now() }), "utf8")
      .toString("base64url");
    expect(readState(`${forged}.not-a-signature`, nonce).ok).toBe(false);
  });

  it("refuses a valid state without the cookie", () => {
    // An attacker who obtains the callback URL still has no cookie, so a
    // replay fails even though the signature is genuine.
    const { state } = issueState(ISSUE);
    expect(readState(state, null)).toEqual({ ok: false, reason: "nonce" });
  });

  it("refuses a valid state with somebody else's cookie", () => {
    const { state } = issueState(ISSUE);
    const other = issueState(ISSUE);
    expect(readState(state, other.nonce)).toEqual({ ok: false, reason: "nonce" });
  });

  it("refuses a flow left open too long", () => {
    // The clock moves rather than the payload: an old `issuedAt` cannot be
    // forged past the signature, so the only honest way to test the age check
    // is to issue a genuine state and then let time pass.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
      const { state, nonce } = issueState(ISSUE);

      vi.setSystemTime(new Date("2026-10-05T12:09:00Z"));
      expect(readState(state, nonce).ok, "nine minutes is still fine").toBe(true);

      vi.setSystemTime(new Date("2026-10-05T12:11:00Z"));
      expect(readState(state, nonce)).toEqual({ ok: false, reason: "expired" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses malformed input rather than throwing", () => {
    expect(readState(null, "n").ok).toBe(false);
    expect(readState("", "n").ok).toBe(false);
    expect(readState("no-dot", "n").ok).toBe(false);
    expect(readState(".sig", "n").ok).toBe(false);
  });

  it("builds the callback from SITE_URL, not from a request", () => {
    // A redirect URI taken from a Host header is one an attacker can point at
    // themselves, and it must match what the provider has registered anyway.
    const url = callbackUrl("LINKEDIN");
    expect(url).toMatch(/^https?:\/\//);
    expect(url).toMatch(/\/api\/social\/oauth\/linkedin\/callback$/);
  });

  it("names the cookie it sets", () => {
    expect(OAUTH_STATE_COOKIE).toBe("emporia.social.oauth");
  });
});
