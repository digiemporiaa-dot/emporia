/**
 * robots.txt, read the way Google documents it (RFC 9309): the most specific
 * user-agent group applies, the longest matching rule wins, `allow` wins a
 * tie, `*` matches any run of characters and `$` anchors the end.
 */

export type RobotsRule = { allow: boolean; pattern: string };
export type Robots = { groups: { agents: string[]; rules: RobotsRule[] }[]; sitemaps: string[] };

export const EMPTY_ROBOTS: Robots = { groups: [], sitemaps: [] };

export function parseRobots(text: string): Robots {
  const groups: Robots["groups"] = [];
  const sitemaps: string[] = [];
  let current: Robots["groups"][number] | null = null;
  let lastWasAgent = false;

  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }
    if ((key === "allow" || key === "disallow") && current) {
      // An empty Disallow means "nothing is disallowed" — no rule at all.
      if (value) current.rules.push({ allow: key === "allow", pattern: value });
    }
  }
  return { groups, sitemaps };
}

function ruleMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const regex = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${regex}${anchored ? "$" : ""}`).test(path);
}

/** The group for this crawler: the longest agent token it contains, else `*`. */
function groupFor(robots: Robots, userAgent: string) {
  const ua = userAgent.toLowerCase();
  let best: { rules: RobotsRule[]; length: number } | null = null;
  for (const group of robots.groups) {
    for (const agent of group.agents) {
      if (agent !== "*" && ua.includes(agent) && (!best || agent.length > best.length)) {
        best = { rules: group.rules, length: agent.length };
      }
    }
  }
  if (best) return best.rules;
  const star = robots.groups.filter((group) => group.agents.includes("*"));
  return star.flatMap((group) => group.rules);
}

export function isAllowed(robots: Robots, userAgent: string, path: string): boolean {
  if (path === "/robots.txt") return true;
  let winner: RobotsRule | null = null;
  for (const rule of groupFor(robots, userAgent)) {
    if (!ruleMatches(rule.pattern, path)) continue;
    if (
      !winner ||
      rule.pattern.length > winner.pattern.length ||
      (rule.pattern.length === winner.pattern.length && rule.allow && !winner.allow)
    ) {
      winner = rule;
    }
  }
  return winner ? winner.allow : true;
}
