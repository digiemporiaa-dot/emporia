import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { resetEnvCache } from "@/lib/config/env";
import { resetStorage } from "@/lib/storage";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { SEO_GOOGLE_SETTING } from "@/lib/seo-intel/google/settings";
import { encryptSecret } from "@/lib/security/secret";
import {
  confirmBrandAsset,
  ensurePortalProperty,
  getClientOnboarding,
  getMyOnboarding,
  myOnboardingProgress,
  portalChooseGscSite,
  portalCompleteGsc,
  portalGscAuthorizationUrl,
  portalListGscSites,
  presignBrandAsset,
  removeBrandAsset,
  saveAnalyticsStep,
  saveBrandColors,
  saveBusinessStep,
  saveCompanyStep,
  saveSocialProfiles,
  saveWebsiteStep,
  setAccessEmail,
  setStepNotApplicable,
} from "@/lib/services/onboarding.service";
import { businessStepSchema, companyStepSchema } from "@/lib/validation/onboarding";
import { S3Double } from "./support/s3-double";
import type { Actor, PortalActor } from "@/lib/actor/types";

/**
 * Client onboarding against the database: a client only ever touches its own
 * onboarding, completion follows the real data, staff can only mark steps not
 * needed, uploads go through the verified path, and the portal Search Console
 * flow is confined to the client's own website.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const TAG = `ob${Date.now().toString(36)}`;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);

describeDb("client onboarding", () => {
  let s3: S3Double;
  let staffId = "";
  let clientA = "";
  let clientB = "";
  let portalA: PortalActor;
  let portalB: PortalActor;
  const media: string[] = [];

  const portal = (userId: string, clientId: string): PortalActor =>
    ({ userId, name: "Client user", email: `${userId}@x.test`, type: "CLIENT", roleName: "CLIENT_USER", roleId: "r", clientId, ip: null, userAgent: null, permissions: new Set() }) as PortalActor;
  const staff = (permissions: string[]): Actor =>
    ({ userId: staffId, name: "Staff", email: "s@x.test", type: "STAFF", roleName: "ADMIN", roleId: "r", clientId: null, ip: null, userAgent: null, permissions: new Set(permissions) }) as Actor;

  const company = (overrides: Record<string, string> = {}) =>
    companyStepSchema.parse({ legalName: "Acme Retail Pvt Ltd", industry: "Retail", website: `${TAG}.example.org`, taxId: "", addressLine1: "1 Main Street", addressLine2: "", city: "Pune", region: "MH", postalCode: "411001", countryCode: "IN", ...overrides });
  const business = () =>
    businessStepSchema.parse({
      publicPhone: "+91 98765 43210",
      publicEmail: "",
      serviceAreas: "Pune",
      googleBusinessUrl: "",
      hours: { mon: [{ open: "09:00", close: "18:00" }], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
    });

  async function upload(actor: PortalActor, kind: "LOGO" | "GUIDELINES" | "OTHER") {
    const ticket = await presignBrandAsset(actor, { filename: "logo.png", contentType: "image/png", size: PNG.length });
    const put = await fetch(ticket.url, { method: "PUT", headers: ticket.headers, body: PNG });
    expect(put.ok).toBe(true);
    await confirmBrandAsset(actor, ticket.uploadId, kind);
  }

  beforeAll(async () => {
    s3 = new S3Double();
    const endpoint = await s3.start();
    Object.assign(process.env, {
      R2_ACCOUNT_ID: "test-account",
      R2_ACCESS_KEY_ID: "test-key",
      R2_SECRET_ACCESS_KEY: "test-secret",
      R2_BUCKET_NAME: "emporia-test",
      R2_PUBLIC_URL: "https://files.example.test",
      R2_ENDPOINT: endpoint,
    });
    resetEnvCache();
    resetStorage();

    staffId = (await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } })).id;
    const [a, b] = await Promise.all(
      ["A", "B"].map((x) => db.client.create({ data: { name: `Onboard ${x} ${TAG}`, slug: `onboard-${x.toLowerCase()}-${TAG}`, ownerId: staffId }, select: { id: true } })),
    );
    clientA = a!.id;
    clientB = b!.id;
    const roleId = (await db.role.findFirstOrThrow({ where: { name: "CLIENT_USER" }, select: { id: true } })).id;
    const [ua, ub] = await Promise.all(
      [clientA, clientB].map((clientId, i) =>
        db.user.create({ data: { email: `portal-${i}-${TAG}@x.test`, name: "Portal", type: "CLIENT", clientId, roleId }, select: { id: true } }),
      ),
    );
    portalA = portal(ua!.id, clientA);
    portalB = portal(ub!.id, clientB);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    if (!portalA || !portalB) return;
    const assets = await db.clientBrandAsset.findMany({ where: { clientId: { in: [clientA, clientB] } }, select: { mediaId: true } });
    const mediaIds = [...media, ...assets.map((asset) => asset.mediaId)];
    await db.client.updateMany({ where: { id: { in: [clientA, clientB] } }, data: { logoId: null } });
    await db.clientBrandAsset.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.mediaVersion.deleteMany({ where: { mediaId: { in: mediaIds } } });
    await db.media.deleteMany({ where: { id: { in: mediaIds } } });
    await db.notification.deleteMany({ where: { entityId: { in: [clientA, clientB] } } });
    await db.seoProperty.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.socialAccount.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.auditLog.deleteMany({ where: { OR: [{ actorId: { in: [portalA.userId, portalB.userId] } }, { entityId: { in: [clientA, clientB] } }] } });
    await db.user.deleteMany({ where: { id: { in: [portalA.userId, portalB.userId] } } });
    await db.client.deleteMany({ where: { id: { in: [clientA, clientB] } } });
    await db.integrationSetting.deleteMany({ where: { provider: SEO_GOOGLE_SETTING } });
    for (const key of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME", "R2_PUBLIC_URL", "R2_ENDPOINT"]) delete process.env[key];
    resetEnvCache();
    resetStorage();
    await s3.stop();
  });

  it("starts at zero, and a page view creates nothing", async () => {
    expect((await myOnboardingProgress(portalA)).percent).toBe(0);
    await getClientOnboarding(staff(["clients.view"]), clientA);
    await getMyOnboarding(portalA);
    expect(await db.clientOnboarding.count({ where: { clientId: clientA } })).toBe(0);
  });

  it("portal steps refuse anyone who is not a client's own user", async () => {
    const notPortal = staff(["clients.edit", "clients.view"]) as unknown as PortalActor;
    await expect(saveCompanyStep(notPortal, company())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getMyOnboarding(notPortal)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ensurePortalProperty(notPortal)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("company details update the client and its business profile, and are audited", async () => {
    const progress = await saveCompanyStep(portalA, company());
    expect(progress.steps.find((s) => s.step === "COMPANY")?.state).toBe("done");
    expect(progress.percent).toBe(14);
    expect(await db.client.findUniqueOrThrow({ where: { id: clientA }, select: { industry: true, website: true } })).toEqual({ industry: "Retail", website: `https://${TAG}.example.org` });
    expect(await db.clientBusinessProfile.findUniqueOrThrow({ where: { clientId: clientA }, select: { legalName: true, countryCode: true } })).toEqual({ legalName: "Acme Retail Pvt Ltd", countryCode: "IN" });
    expect(await db.auditLog.count({ where: { entityId: clientA, actorId: portalA.userId } })).toBeGreaterThan(0);
    // Client B saw none of it.
    expect((await myOnboardingProgress(portalB)).percent).toBe(0);
  });

  it("brand: a verified upload becomes the logo; colours complete the step", async () => {
    await upload(portalA, "LOGO");
    const view = await getMyOnboarding(portalA);
    expect(view.assets).toHaveLength(1);
    expect(view.client.logo?.url).toMatch(/^https:\/\/files\.example\.test\//);
    expect(view.progress.steps.find((s) => s.step === "BRAND")?.state).toBe("todo");
    const progress = await saveBrandColors(portalA, ["#002A3A", "#DF1F38"]);
    expect(progress.steps.find((s) => s.step === "BRAND")?.state).toBe("done");
  });

  it("a second logo does not replace the client's logo", async () => {
    const before = (await db.client.findUniqueOrThrow({ where: { id: clientA } })).logoId;
    await upload(portalA, "LOGO");
    expect((await db.client.findUniqueOrThrow({ where: { id: clientA } })).logoId).toBe(before);
    const second = await db.clientBrandAsset.findFirstOrThrow({ where: { clientId: clientA, NOT: { mediaId: before ?? "" } } });
    await removeBrandAsset(portalA, second.id);
    media.push(second.mediaId);
    expect((await db.client.findUniqueOrThrow({ where: { id: clientA } })).logoId).toBe(before);
  });

  it("an upload whose bytes are not what was claimed is refused and filed nowhere", async () => {
    const ticket = await presignBrandAsset(portalA, { filename: "logo.png", contentType: "image/png", size: 8 });
    await fetch(ticket.url, { method: "PUT", headers: ticket.headers, body: Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]) });
    await expect(confirmBrandAsset(portalA, ticket.uploadId, "LOGO")).rejects.toBeInstanceOf(ValidationError);
    expect(await db.clientBrandAsset.count({ where: { clientId: clientA } })).toBe(1);
  });

  it("an upload started by one client cannot be finished by another", async () => {
    const ticket = await presignBrandAsset(portalA, { filename: "logo.png", contentType: "image/png", size: PNG.length });
    await fetch(ticket.url, { method: "PUT", headers: ticket.headers, body: PNG });
    await expect(confirmBrandAsset(portalB, ticket.uploadId, "LOGO")).rejects.toThrow(/not started by you/);
    expect(await db.clientBrandAsset.count({ where: { clientId: clientB } })).toBe(0);
  });

  it("another client's brand file cannot be removed — it is simply not found", async () => {
    const asset = await db.clientBrandAsset.findFirstOrThrow({ where: { clientId: clientA } });
    await expect(removeBrandAsset(portalB, asset.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await db.clientBrandAsset.count({ where: { id: asset.id } })).toBe(1);
  });

  it("website access stores no password and keeps the first confirmation time", async () => {
    await saveWebsiteStep(portalA, { platform: "WORDPRESS", loginUrl: "https://acme.example.org/wp-admin", notes: null, confirmed: true });
    const first = (await db.clientOnboarding.findUniqueOrThrow({ where: { clientId: clientA } })).websiteAccessConfirmedAt;
    expect(first).not.toBeNull();
    await saveWebsiteStep(portalA, { platform: "WORDPRESS", loginUrl: null, notes: "Editor role", confirmed: true });
    expect((await db.clientOnboarding.findUniqueOrThrow({ where: { clientId: clientA } })).websiteAccessConfirmedAt).toEqual(first);
    await saveWebsiteStep(portalA, { platform: "WORDPRESS", loginUrl: null, notes: null, confirmed: false });
    expect((await db.clientOnboarding.findUniqueOrThrow({ where: { clientId: clientA } })).websiteAccessConfirmedAt).toBeNull();
    await saveWebsiteStep(portalA, { platform: "WORDPRESS", loginUrl: null, notes: null, confirmed: true });
  });

  it("only staff with clients.edit can mark a step not needed — never the client", async () => {
    await expect(setStepNotApplicable(portalA as unknown as Actor, { clientId: clientA, step: "SOCIAL", notApplicable: true })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setStepNotApplicable(staff(["clients.view"]), { clientId: clientA, step: "SOCIAL", notApplicable: true })).rejects.toBeInstanceOf(ForbiddenError);
    const marked = await setStepNotApplicable(staff(["clients.edit"]), { clientId: clientA, step: "SOCIAL", notApplicable: true });
    expect(marked.applicable).toBe(6);
    const unmarked = await setStepNotApplicable(staff(["clients.edit"]), { clientId: clientA, step: "SOCIAL", notApplicable: false });
    expect(unmarked.applicable).toBe(7);
  });

  it("social completes only when every listed platform is connected by staff", async () => {
    let progress = await saveSocialProfiles(portalA, [{ platform: "INSTAGRAM", handle: "@acme" }]);
    expect(progress.steps.find((s) => s.step === "SOCIAL")?.state).toBe("todo");
    await db.socialAccount.create({ data: { clientId: clientA, provider: "INSTAGRAM", externalId: `ig-${TAG}`, name: "Acme", status: "CONNECTED" } });
    // Another client's connected account never counts for this one.
    await db.socialAccount.create({ data: { clientId: clientB, provider: "FACEBOOK", externalId: `fb-${TAG}`, name: "B", status: "CONNECTED" } });
    progress = await saveSocialProfiles(portalA, [{ platform: "INSTAGRAM", handle: "@acme" }]);
    expect(progress.steps.find((s) => s.step === "SOCIAL")?.state).toBe("done");
    progress = await saveSocialProfiles(portalA, [{ platform: "INSTAGRAM", handle: "@acme" }, { platform: "FACEBOOK", handle: "acme" }]);
    expect(progress.steps.find((s) => s.step === "SOCIAL")?.state).toBe("todo");
    await saveSocialProfiles(portalA, [{ platform: "INSTAGRAM", handle: "@acme" }]);
  });

  describe("Search Console from the portal", () => {
    it("needs the website first, then makes the property from it — for this client only", async () => {
      await expect(ensurePortalProperty(portalB)).rejects.toThrow(/Add your website/);
      const propertyId = await ensurePortalProperty(portalA);
      const property = await db.seoProperty.findUniqueOrThrow({ where: { id: propertyId } });
      expect(property).toMatchObject({ clientId: clientA, domain: `${TAG}.example.org` });
      expect(await ensurePortalProperty(portalA)).toBe(propertyId);
    });

    it("refuses another client's website at every step", async () => {
      const propertyA = await ensurePortalProperty(portalA);
      await expect(portalGscAuthorizationUrl(portalB, propertyA, "state")).rejects.toBeInstanceOf(NotFoundError);
      await expect(portalCompleteGsc(portalB, propertyA, "code")).rejects.toBeInstanceOf(NotFoundError);
      await expect(portalListGscSites(portalB, propertyA)).rejects.toBeInstanceOf(NotFoundError);
      await expect(portalChooseGscSite(portalB, propertyA, `sc-domain:${TAG}.example.org`)).rejects.toBeInstanceOf(NotFoundError);
    });

    it("signs in, then accepts only the client's own domain, and completes the step", async () => {
      await db.integrationSetting.upsert({
        where: { provider: SEO_GOOGLE_SETTING },
        create: { provider: SEO_GOOGLE_SETTING, isEnabled: true, config: { oauthClientId: `${TAG}.apps.googleusercontent.com`, oauthClientSecret: encryptSecret("s") } },
        update: { config: { oauthClientId: `${TAG}.apps.googleusercontent.com`, oauthClientSecret: encryptSecret("s") } },
      });
      vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
        if (url === "https://oauth2.googleapis.com/token") return json({ access_token: "ya29.p", refresh_token: "1//r", expires_in: 3600, scope: "https://www.googleapis.com/auth/webmasters.readonly openid email" });
        if (url === "https://openidconnect.googleapis.com/v1/userinfo") return json({ email: "owner@acme.test" });
        if (url === "https://www.googleapis.com/webmasters/v3/sites")
          return json({ siteEntry: [{ siteUrl: `sc-domain:${TAG}.example.org`, permissionLevel: "siteOwner" }, { siteUrl: "sc-domain:someone-else.example.net", permissionLevel: "siteOwner" }] });
        if (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost")) return fetch(input as string, init);
        throw new Error(`unexpected ${url}`);
      });
      const propertyId = await ensurePortalProperty(portalA);
      const authorize = new URL(await portalGscAuthorizationUrl(portalA, propertyId, "signed-state"));
      expect(authorize.searchParams.get("state")).toBe("signed-state");
      await portalCompleteGsc(portalA, propertyId, "code");
      // Signed in is not connected: the step waits for the property to be chosen.
      expect((await myOnboardingProgress(portalA)).steps.find((s) => s.step === "SEARCH_CONSOLE")?.state).toBe("todo");
      const sites = await portalListGscSites(portalA, propertyId);
      expect(sites[0]).toMatchObject({ siteUrl: `sc-domain:${TAG}.example.org`, matches: true });
      await expect(portalChooseGscSite(portalA, propertyId, "sc-domain:someone-else.example.net")).rejects.toBeInstanceOf(ValidationError);
      const progress = await portalChooseGscSite(portalA, propertyId, `sc-domain:${TAG}.example.org`);
      expect(progress.steps.find((s) => s.step === "SEARCH_CONSOLE")?.state).toBe("done");
      vi.unstubAllGlobals();
    });
  });

  it("finishing every step stamps completion and tells the account owner — once", async () => {
    await saveAnalyticsStep(portalA, { propertyId: "123456789", confirmed: true });
    const progress = await saveBusinessStep(portalA, business());
    expect(progress).toMatchObject({ percent: 100, complete: true });
    const onboarding = await db.clientOnboarding.findUniqueOrThrow({ where: { clientId: clientA } });
    expect(onboarding.completedAt).not.toBeNull();
    expect(await db.notification.count({ where: { entityId: clientA, userId: staffId } })).toBe(1);

    await saveBusinessStep(portalA, business());
    expect(await db.notification.count({ where: { entityId: clientA, userId: staffId } })).toBe(1);
    expect((await db.clientOnboarding.findUniqueOrThrow({ where: { clientId: clientA } })).completedAt).toEqual(onboarding.completedAt);
  });

  it("staff read any client's onboarding with clients.view, and the access email needs settings.edit", async () => {
    await expect(getClientOnboarding(staff([]), clientA)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await getClientOnboarding(staff(["clients.view"]), clientA)).progress.percent).toBe(100);
    await expect(getClientOnboarding(staff(["clients.view"]), "missing")).rejects.toBeInstanceOf(NotFoundError);
    await expect(setAccessEmail(staff(["settings.view"]), "access@agency.test")).rejects.toBeInstanceOf(ForbiddenError);
    await setAccessEmail(staff(["settings.edit"]), `access-${TAG}@agency.test`);
    expect((await getMyOnboarding(portalB)).accessEmail).toBe(`access-${TAG}@agency.test`);
    await setAccessEmail(staff(["settings.edit"]), null);
  });

  it("removing the logo clears it from the client and the step", async () => {
    const asset = await db.clientBrandAsset.findFirstOrThrow({ where: { clientId: clientA, kind: "LOGO" } });
    const progress = await removeBrandAsset(portalA, asset.id);
    expect(progress.steps.find((s) => s.step === "BRAND")?.state).toBe("todo");
    expect((await db.client.findUniqueOrThrow({ where: { id: clientA } })).logoId).toBeNull();
    expect((await db.media.findUniqueOrThrow({ where: { id: asset.mediaId } })).deletedAt).not.toBeNull();
    media.push(asset.mediaId);
  });
});
