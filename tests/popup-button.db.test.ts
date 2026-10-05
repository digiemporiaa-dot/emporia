import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { buttonPopupOptions, resolveButtonPopup, resolveForPage } from "@/lib/services/popup.service";
import type { Actor } from "@/lib/actor/types";

/**
 * Button popups against the database: a button opens its popup only while it
 * is switched on, a button popup and inside its dates — on every click, with
 * no targeting — and button popups never come back from automatic resolution.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const TAG = `pb${Date.now().toString(36)}`;
const NOW = new Date("2026-06-15T12:00:00Z");

describeDb("Button popups", () => {
  const ids: Record<string, string> = {};
  let staffId = "";
  const staff = (permissions: string[]): Actor =>
    ({ userId: staffId, name: "Staff", email: "s@x.test", type: "STAFF", roleName: "CONTENT_MANAGER", roleId: null, clientId: null, ip: null, userAgent: "vitest", permissions: new Set(permissions) }) as Actor;

  const make = async (key: string, data: Record<string, unknown>) => {
    ids[key] = (
      await db.popup.create({
        data: { name: `${TAG} ${key}`, title: `Title ${key}`, trigger: "BUTTON_CLICK", frequency: "ONCE_PER_USER", isActive: true, priority: 999, ...data },
        select: { id: true },
      })
    ).id;
  };

  beforeAll(async () => {
    staffId = (await db.user.findFirstOrThrow({ where: { type: "STAFF", status: "ACTIVE" }, select: { id: true } })).id;
    await make("live", {});
    await make("off", { isActive: false });
    await make("future", { startsAt: new Date("2026-07-01T00:00:00Z") });
    await make("ended", { endsAt: new Date("2026-06-01T00:00:00Z") });
    await make("auto", { trigger: "TIME_DELAY", triggerValue: 5 });
    // A button popup with a global target and top priority: still never automatic.
    await make("targeted", {});
    await db.popupTarget.create({ data: { popupId: ids["targeted"] as string, type: "GLOBAL" } });
  });

  afterAll(async () => {
    await db.popup.deleteMany({ where: { name: { startsWith: TAG } } });
  });

  it("opens a live button popup on every click, whatever its frequency", async () => {
    const first = await resolveButtonPopup(ids["live"] as string, NOW);
    expect(first).toMatchObject({ id: ids["live"], title: "Title live", trigger: "BUTTON_CLICK" });
    // Nothing is remembered between clicks: the same answer again.
    expect((await resolveButtonPopup(ids["live"] as string, NOW))?.id).toBe(ids["live"]);
  });

  it("opens nothing for a popup that is off, outside its dates, automatic or unknown", async () => {
    for (const key of ["off", "future", "ended", "auto"]) expect(await resolveButtonPopup(ids[key] as string, NOW)).toBeNull();
    expect(await resolveButtonPopup("cmnotarealpopup000000000", NOW)).toBeNull();
  });

  it("never returns a button popup from automatic resolution", async () => {
    const chosen = await resolveForPage(
      { path: "/", serviceId: null, cityId: null, serviceCityPageId: null, packageId: null },
      { device: "DESKTOP", isNewVisitor: true, seen: {}, seenThisSession: [], now: NOW },
    );
    expect(chosen?.id).not.toBe(ids["targeted"]);
    expect(chosen?.trigger).not.toBe("BUTTON_CLICK");
  });

  it("lists button popups for whoever edits buttons, live ones first", async () => {
    const options = (await buttonPopupOptions(staff(["pages.edit"]))).filter((o) => o.name.startsWith(TAG));
    expect(options.map((o) => o.name.replace(`${TAG} `, ""))).toEqual(["ended", "future", "live", "targeted", "off"]);
    expect(options.every((o) => o.id !== ids["auto"])).toBe(true);
    expect((await buttonPopupOptions(staff(["settings.edit"]))).length).toBeGreaterThan(0);
    await expect(buttonPopupOptions(staff(["pages.view"]))).rejects.toBeInstanceOf(ForbiddenError);
  });
});
