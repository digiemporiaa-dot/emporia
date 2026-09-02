import { describe, expect, it } from "vitest";
import { deriveHealth } from "@/lib/projects/health";
import {
  blockingDependencies,
  canTransitionContent,
  canTransitionProject,
  canTransitionTask,
  contentTransitionError,
  wouldCycle,
} from "@/lib/projects/lifecycle";
import { formatMinutes, hoursToMinutes, minutesToHours } from "@/lib/projects/hours";

/**
 * The delivery rules that are pure functions: health derivation, the three
 * transition maps, dependency cycles and time conversion.
 */

const NOW = new Date("2026-06-15T12:00:00Z");
const START = new Date("2026-06-01T00:00:00Z");

describe("deriveHealth", () => {
  it("is on track with no tasks and no due date", () => {
    const result = deriveHealth({
      now: NOW,
      startsAt: START,
      dueAt: null,
      completedAt: null,
      tasks: [],
      milestones: [],
    });

    expect(result.health).toBe("ON_TRACK");
    expect(result.progress).toBeNull();
  });

  it("is delayed once the project is past its own due date", () => {
    const result = deriveHealth({
      now: NOW,
      startsAt: START,
      dueAt: new Date("2026-06-10T00:00:00Z"),
      completedAt: null,
      tasks: [{ status: "DONE", dueAt: null }],
      milestones: [],
    });

    expect(result.health).toBe("DELAYED");
    expect(result.reason).toMatch(/past its due date/i);
  });

  it("is not delayed once completed, whatever the dates say", () => {
    const result = deriveHealth({
      now: NOW,
      startsAt: START,
      dueAt: new Date("2026-06-10T00:00:00Z"),
      completedAt: new Date("2026-06-12T00:00:00Z"),
      tasks: [],
      milestones: [],
    });

    expect(result.health).toBe("ON_TRACK");
  });

  it("is delayed when a milestone is past due and not complete", () => {
    const result = deriveHealth({
      now: NOW,
      startsAt: START,
      dueAt: new Date("2026-07-31T00:00:00Z"),
      completedAt: null,
      tasks: [],
      milestones: [
        { status: "COMPLETED", dueAt: new Date("2026-06-05T00:00:00Z") },
        { status: "IN_PROGRESS", dueAt: new Date("2026-06-10T00:00:00Z") },
      ],
    });

    expect(result.health).toBe("DELAYED");
    expect(result.overdueMilestones).toBe(1);
  });

  it("is at risk when an open task is overdue but nothing else is", () => {
    const result = deriveHealth({
      now: NOW,
      startsAt: START,
      dueAt: new Date("2026-07-31T00:00:00Z"),
      completedAt: null,
      tasks: [
        { status: "IN_PROGRESS", dueAt: new Date("2026-06-14T00:00:00Z") },
        { status: "DONE", dueAt: new Date("2026-06-02T00:00:00Z") },
      ],
      milestones: [],
    });

    expect(result.health).toBe("AT_RISK");
    expect(result.overdueTasks).toBe(1);
  });

  it("does not count a cancelled task as overdue", () => {
    const result = deriveHealth({
      now: NOW,
      startsAt: START,
      dueAt: new Date("2026-07-31T00:00:00Z"),
      completedAt: null,
      tasks: [{ status: "CANCELLED", dueAt: new Date("2026-06-01T00:00:00Z") }],
      milestones: [],
    });

    expect(result.overdueTasks).toBe(0);
    expect(result.health).toBe("ON_TRACK");
  });

  it("is at risk when the time is mostly gone and the work is not", () => {
    // 1 June to 1 July, now 15 June: 47% elapsed — under the halfway trigger.
    const halfway = deriveHealth({
      now: NOW,
      startsAt: START,
      dueAt: new Date("2026-07-01T00:00:00Z"),
      completedAt: null,
      tasks: [
        { status: "TODO", dueAt: null },
        { status: "TODO", dueAt: null },
        { status: "TODO", dueAt: null },
        { status: "TODO", dueAt: null },
      ],
      milestones: [],
    });
    expect(halfway.health).toBe("ON_TRACK");

    // 1 June to 25 June, now 15 June: 58% elapsed with 0% closed.
    const behind = deriveHealth({
      now: NOW,
      startsAt: START,
      dueAt: new Date("2026-06-25T00:00:00Z"),
      completedAt: null,
      tasks: [
        { status: "TODO", dueAt: null },
        { status: "TODO", dueAt: null },
        { status: "TODO", dueAt: null },
        { status: "TODO", dueAt: null },
      ],
      milestones: [],
    });
    expect(behind.health).toBe("AT_RISK");
    expect(behind.progress).toBe(0);
  });

  it("stays on track when the work is keeping pace with the clock", () => {
    const result = deriveHealth({
      now: NOW,
      startsAt: START,
      dueAt: new Date("2026-06-25T00:00:00Z"),
      completedAt: null,
      tasks: [
        { status: "DONE", dueAt: null },
        { status: "DONE", dueAt: null },
        { status: "DONE", dueAt: null },
        { status: "TODO", dueAt: null },
      ],
      milestones: [],
    });

    expect(result.health).toBe("ON_TRACK");
    expect(result.progress).toBe(75);
  });

  it("reports overdue counts even when a worse verdict wins", () => {
    const result = deriveHealth({
      now: NOW,
      startsAt: START,
      dueAt: new Date("2026-06-10T00:00:00Z"),
      completedAt: null,
      tasks: [{ status: "TODO", dueAt: new Date("2026-06-01T00:00:00Z") }],
      milestones: [{ status: "PENDING", dueAt: new Date("2026-06-02T00:00:00Z") }],
    });

    expect(result.health).toBe("DELAYED");
    expect(result.overdueTasks).toBe(1);
    expect(result.overdueMilestones).toBe(1);
  });
});

describe("task transitions", () => {
  it("lets work move backwards, because delivery does", () => {
    expect(canTransitionTask("IN_REVIEW", "IN_PROGRESS")).toBe(true);
    expect(canTransitionTask("DONE", "IN_PROGRESS")).toBe(true);
  });

  it("only reopens a cancelled task to the top of the board", () => {
    expect(canTransitionTask("CANCELLED", "TODO")).toBe(true);
    expect(canTransitionTask("CANCELLED", "DONE")).toBe(false);
  });
});

describe("project transitions", () => {
  it("refuses to rewrite a completed project as cancelled", () => {
    expect(canTransitionProject("COMPLETED", "CANCELLED")).toBe(false);
    expect(canTransitionProject("COMPLETED", "ACTIVE")).toBe(true);
  });

  it("cannot complete a project straight from planning", () => {
    expect(canTransitionProject("PLANNING", "COMPLETED")).toBe(false);
    expect(canTransitionProject("PLANNING", "ACTIVE")).toBe(true);
  });
});

describe("content workflow", () => {
  it("walks the full pipeline", () => {
    const path = [
      "IDEA",
      "DRAFT",
      "INTERNAL_REVIEW",
      "CLIENT_REVIEW",
      "APPROVED",
      "SCHEDULED",
      "PUBLISHED",
    ] as const;

    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i] as (typeof path)[number];
      const to = path[i + 1] as (typeof path)[number];
      expect(canTransitionContent(from, to), `${from} → ${to}`).toBe(true);
    }
  });

  it("refuses to schedule what was never approved", () => {
    expect(canTransitionContent("DRAFT", "SCHEDULED")).toBe(false);
    expect(contentTransitionError("DRAFT", "SCHEDULED")).toMatch(/cannot move straight/i);
  });

  it("refuses to publish what was never scheduled", () => {
    expect(canTransitionContent("APPROVED", "PUBLISHED")).toBe(false);
  });

  it("always allows sending work back for changes", () => {
    expect(canTransitionContent("INTERNAL_REVIEW", "DRAFT")).toBe(true);
    expect(canTransitionContent("CLIENT_REVIEW", "DRAFT")).toBe(true);
    expect(canTransitionContent("SCHEDULED", "APPROVED")).toBe(true);
  });

  it("treats published as terminal", () => {
    expect(canTransitionContent("PUBLISHED", "SCHEDULED")).toBe(false);
    expect(contentTransitionError("PUBLISHED", "DRAFT")).toMatch(/cannot move back/i);
  });
});

describe("dependency cycles", () => {
  const edges = [
    { taskId: "b", dependsOnId: "a" },
    { taskId: "c", dependsOnId: "b" },
  ];

  it("catches a direct self-dependency", () => {
    expect(wouldCycle(edges, "a", "a")).toBe(true);
  });

  it("catches a two-task loop", () => {
    expect(wouldCycle(edges, "a", "b")).toBe(true);
  });

  it("catches a loop through a chain", () => {
    expect(wouldCycle(edges, "a", "c")).toBe(true);
  });

  it("allows an edge that adds no loop", () => {
    expect(wouldCycle(edges, "d", "a")).toBe(false);
    expect(wouldCycle(edges, "c", "a")).toBe(false);
  });

  it("terminates on a graph that already contains a loop", () => {
    const looped = [
      { taskId: "x", dependsOnId: "y" },
      { taskId: "y", dependsOnId: "x" },
    ];
    expect(wouldCycle(looped, "z", "x")).toBe(false);
  });

  it("lists only the unfinished prerequisites", () => {
    const blocking = blockingDependencies([
      { dependsOnId: "one", status: "DONE" },
      { dependsOnId: "two", status: "IN_PROGRESS" },
      { dependsOnId: "three", status: "CANCELLED" },
      { dependsOnId: "four", status: "TODO" },
    ]);

    expect(blocking).toEqual(["two", "four"]);
  });
});

describe("time conversion", () => {
  it("converts whole and half hours exactly", () => {
    expect(hoursToMinutes("8")).toBe(480);
    expect(hoursToMinutes("7.5")).toBe(450);
    expect(hoursToMinutes("0.25")).toBe(15);
  });

  it("does not lose a minute to binary floating point", () => {
    // 4.1 * 60 is 245.99999999999997 as a JS number, and Math.floor of that
    // is 245 — an hour of work quietly becoming 4h 05m instead of 4h 06m.
    expect(4.1 * 60).not.toBe(246);
    expect(Math.floor(4.1 * 60)).toBe(245);
    expect(hoursToMinutes("4.1")).toBe(246);
    expect(hoursToMinutes("2.05")).toBe(123);
  });

  it("rounds a fraction of a minute half-up", () => {
    expect(hoursToMinutes("0.008")).toBe(0);
    expect(hoursToMinutes("0.009")).toBe(1);
  });

  it("round-trips back to hours", () => {
    expect(minutesToHours(450)).toBe("7.50");
    expect(minutesToHours(246)).toBe("4.10");
    expect(minutesToHours(0)).toBe("0.00");
  });

  it("formats minutes for people rather than spreadsheets", () => {
    expect(formatMinutes(450)).toBe("7h 30m");
    expect(formatMinutes(480)).toBe("8h");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(0)).toBe("0m");
  });
});
