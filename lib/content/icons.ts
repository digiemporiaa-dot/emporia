/**
 * The icon set an editor can choose from.
 *
 * A closed list, not a free-text field. Lucide ships well over a thousand
 * icons; letting a block store an arbitrary name would mean either bundling
 * all of them or rendering nothing when someone types one that does not exist.
 * A curated set keeps the bundle small and makes "choose an icon" a picker
 * rather than a guess.
 *
 * Names here are stable identifiers stored in section JSON — renaming one
 * orphans every block using it, so add rather than rename.
 */

export const ICON_NAMES = [
  "search",
  "megaphone",
  "target",
  "trending-up",
  "bar-chart",
  "line-chart",
  "globe",
  "map-pin",
  "users",
  "handshake",
  "message-circle",
  "mail",
  "phone",
  "calendar",
  "clock",
  "check",
  "shield",
  "zap",
  "sparkles",
  "lightbulb",
  "pen-tool",
  "layout",
  "code",
  "smartphone",
  "shopping-cart",
  "rupee",
  "award",
  "rocket",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

export const ICON_SET: ReadonlySet<string> = new Set(ICON_NAMES);

export function isIconName(value: string): value is IconName {
  return ICON_SET.has(value);
}

/** Human labels for the picker, so it does not present kebab-case to an editor. */
export const ICON_LABELS: Record<IconName, string> = {
  search: "Search",
  megaphone: "Megaphone",
  target: "Target",
  "trending-up": "Trending up",
  "bar-chart": "Bar chart",
  "line-chart": "Line chart",
  globe: "Globe",
  "map-pin": "Location pin",
  users: "People",
  handshake: "Handshake",
  "message-circle": "Message",
  mail: "Email",
  phone: "Phone",
  calendar: "Calendar",
  clock: "Clock",
  check: "Tick",
  shield: "Shield",
  zap: "Lightning",
  sparkles: "Sparkles",
  lightbulb: "Idea",
  layout: "Layout",
  "pen-tool": "Design",
  code: "Code",
  smartphone: "Mobile",
  "shopping-cart": "Ecommerce",
  rupee: "Rupee",
  award: "Award",
  rocket: "Rocket",
};
