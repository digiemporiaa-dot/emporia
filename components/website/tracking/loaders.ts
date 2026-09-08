/**
 * Script loaders, one per provider.
 *
 * Each is idempotent: the registry below records what has already run, so a
 * re-render, a consent change or a client-side navigation cannot initialise a
 * pixel twice. Double initialisation is not cosmetic — it doubles page views
 * and conversions, which corrupts the numbers a campaign is judged on.
 *
 * The registry is a module-level Set rather than a `window.__something` flag:
 * it lives and dies with the JavaScript that owns it, cannot be poked at from
 * the console or another script, and does not add to the global namespace.
 */

/**
 * Each vendor's global is a callable queue-shim before its real script lands.
 * Typed explicitly rather than inferred: `NonNullable<typeof window.fbq>`
 * inside the assignment that creates it resolves to `never`.
 */
type QueueShim<Extra = unknown> = ((...args: unknown[]) => void) & Extra;

const initialised = new Set<string>();

/** Exposed for tests, which need a clean slate between cases. */
export function resetLoaders(): void {
  initialised.clear();
  googleConsentSent = false;
}

export function hasInitialised(key: string): boolean {
  return initialised.has(key);
}

/** Runs `load` at most once per key, for the life of the page. */
function once(key: string, load: () => void): void {
  if (initialised.has(key)) return;
  initialised.add(key);
  load();
}

function injectScript(src: string, attrs: Record<string, string> = {}): void {
  const script = document.createElement("script");
  script.async = true;
  script.src = src;
  for (const [name, value] of Object.entries(attrs)) script.setAttribute(name, value);
  document.head.appendChild(script);
}

/**
 * The dataLayer and the shared `gtag` shim.
 *
 * GTM, GA4 and Google Ads all speak through the same queue, so it is created
 * once and reused rather than each loader defining its own.
 */
function ensureGtag(): void {
  const w = window as unknown as { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };
  w.dataLayer = w.dataLayer ?? [];
  if (!w.gtag) {
    w.gtag = function gtag(...args: unknown[]) {
      w.dataLayer!.push(args);
    };
  }
}

export function loadGtm(id: string): void {
  once(`gtm:${id}`, () => {
    ensureGtag();
    (window as unknown as { dataLayer: unknown[] }).dataLayer.push({
      "gtm.start": Date.now(),
      event: "gtm.js",
    });
    injectScript(`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(id)}`);
  });
}

export function loadGa4(id: string): void {
  once(`ga4:${id}`, () => {
    ensureGtag();
    injectScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`);
    const gtag = (window as unknown as { gtag: (...a: unknown[]) => void }).gtag;
    gtag("js", new Date());
    gtag("config", id);
  });
}

export function loadGoogleAds(id: string): void {
  once(`ads:${id}`, () => {
    ensureGtag();
    // Shares the gtag.js tag with GA4; requesting it twice is harmless because
    // `injectScript` only runs once per key and the browser caches the file.
    injectScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`);
    const gtag = (window as unknown as { gtag: (...a: unknown[]) => void }).gtag;
    gtag("js", new Date());
    gtag("config", id);
  });
}

export function loadMetaPixel(id: string): void {
  once(`meta:${id}`, () => {
    type Fbq = QueueShim<{
      queue: unknown[];
      loaded: boolean;
      version: string;
      callMethod?: (...args: unknown[]) => void;
    }>;
    const w = window as unknown as { fbq?: Fbq; _fbq?: Fbq };

    if (!w.fbq) {
      const fbq = function (...args: unknown[]) {
        if (fbq.callMethod) fbq.callMethod(...args);
        else fbq.queue.push(args);
      } as Fbq;
      fbq.queue = [];
      fbq.loaded = true;
      fbq.version = "2.0";
      w.fbq = fbq;
      w._fbq = fbq;
    }

    injectScript("https://connect.facebook.net/en_US/fbevents.js");
    // Exactly one init, guaranteed by `once`.
    w.fbq!("init", id);
    w.fbq!("track", "PageView");
  });
}

export function loadClarity(id: string): void {
  once(`clarity:${id}`, () => {
    type Clarity = QueueShim<{ q: unknown[] }>;
    const w = window as unknown as { clarity?: Clarity };
    if (!w.clarity) {
      const clarity = function (...args: unknown[]) {
        clarity.q.push(args);
      } as Clarity;
      clarity.q = [];
      w.clarity = clarity;
    }
    injectScript(`https://www.clarity.ms/tag/${encodeURIComponent(id)}`);
  });
}

export function loadHotjar(id: string): void {
  once(`hotjar:${id}`, () => {
    type Hj = QueueShim<{ q: unknown[] }>;
    const w = window as unknown as { hj?: Hj; _hjSettings?: { hjid: number; hjsv: number } };
    if (!w.hj) {
      const hj = function (...args: unknown[]) {
        hj.q.push(args);
      } as Hj;
      hj.q = [];
      w.hj = hj;
    }
    w._hjSettings = { hjid: Number(id), hjsv: 6 };
    injectScript(`https://static.hotjar.com/c/hotjar-${encodeURIComponent(id)}.js?sv=6`);
  });
}

export function loadPinterest(id: string): void {
  once(`pinterest:${id}`, () => {
    type Pintrk = QueueShim<{ queue: unknown[]; version: string }>;
    const w = window as unknown as { pintrk?: Pintrk };
    if (!w.pintrk) {
      const pintrk = function (...args: unknown[]) {
        pintrk.queue.push(args);
      } as Pintrk;
      pintrk.queue = [];
      pintrk.version = "3.0";
      w.pintrk = pintrk;
    }
    injectScript("https://s.pinimg.com/ct/core.js");
    w.pintrk!("load", id);
    w.pintrk!("page");
  });
}

export function loadTiktok(id: string): void {
  once(`tiktok:${id}`, () => {
    type Ttq = QueueShim<{ _q: unknown[] }>;
    const w = window as unknown as { ttq?: Ttq };
    if (!w.ttq) {
      const ttq = function (...args: unknown[]) {
        ttq._q.push(args);
      } as Ttq;
      ttq._q = [];
      w.ttq = ttq;
    }
    injectScript(`https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${encodeURIComponent(id)}&lib=ttq`);
  });
}

export function loadSnapchat(id: string): void {
  once(`snap:${id}`, () => {
    type Snaptr = QueueShim<{ queue: unknown[]; handleRequest?: (...args: unknown[]) => void }>;
    const w = window as unknown as { snaptr?: Snaptr };
    if (!w.snaptr) {
      const snaptr = function (...args: unknown[]) {
        if (snaptr.handleRequest) snaptr.handleRequest(...args);
        else snaptr.queue.push(args);
      } as Snaptr;
      snaptr.queue = [];
      w.snaptr = snaptr;
    }
    injectScript("https://sc-static.net/scevent.min.js");
    w.snaptr!("init", id);
    w.snaptr!("track", "PAGE_VIEW");
  });
}

/**
 * A `Lead` conversion, browser side.
 *
 * `eventId` is generated once by the caller and sent to the server as well, so
 * the two copies of one conversion share an id and Meta counts them once.
 *
 * Silent when the pixel was never loaded — which is the normal outcome when a
 * visitor refused marketing consent, and exactly the behaviour wanted: the
 * conversion is not reported rather than queued for later.
 */
export function trackMetaLead(eventId: string): void {
  const w = window as unknown as { fbq?: (...args: unknown[]) => void };
  if (!w.fbq) return;
  w.fbq("track", "Lead", {}, { eventID: eventId });
}

/**
 * Google Consent Mode.
 *
 * GTM loads regardless of the visitor's answer, because a container is not
 * itself a tag — what it may then do is decided by this signal. The first call
 * sets defaults (before any tag can fire), and every call after it is an
 * update, which is what tells Google a visitor has just changed their mind.
 */
let googleConsentSent = false;

export function applyGoogleConsent(state: { analytics: boolean; marketing: boolean }): void {
  ensureGtag();
  const gtag = (window as unknown as { gtag: (...a: unknown[]) => void }).gtag;
  const signal = {
    analytics_storage: state.analytics ? "granted" : "denied",
    ad_storage: state.marketing ? "granted" : "denied",
    ad_user_data: state.marketing ? "granted" : "denied",
    ad_personalization: state.marketing ? "granted" : "denied",
  };

  if (googleConsentSent) {
    gtag("consent", "update", signal);
    return;
  }
  googleConsentSent = true;
  gtag("consent", "default", { ...signal, wait_for_update: 500 });
}
