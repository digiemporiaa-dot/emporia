import { Decimal } from "@/lib/money";
import type { Facts } from "@/lib/automation/types";

/**
 * Condition evaluation.
 *
 * A condition is `field operator value` read against the trigger's facts. All
 * conditions on a rule must hold — an OR is expressed as two rules, which keeps
 * the editor and this evaluator simple enough to reason about.
 *
 * Numeric comparisons go through Decimal, so a rule like "budget is over
 * 500000" is exact for money as well as for a score.
 */

export const OPERATORS = [
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "not_contains",
  "in",
  "not_in",
  "is_empty",
  "is_not_empty",
] as const;

export type Operator = (typeof OPERATORS)[number];

export const OPERATOR_LABEL: Record<Operator, string> = {
  eq: "is",
  ne: "is not",
  gt: "is more than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  contains: "contains",
  not_contains: "does not contain",
  in: "is one of",
  not_in: "is none of",
  is_empty: "is empty",
  is_not_empty: "is not empty",
};

/** Operators that need no right-hand value. */
export const UNARY_OPERATORS: readonly Operator[] = ["is_empty", "is_not_empty"];

export function isOperator(value: string): value is Operator {
  return (OPERATORS as readonly string[]).includes(value);
}

export type Condition = {
  field: string;
  operator: string;
  value: unknown;
};

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/** Decimal for both sides, or null when either is not a number. */
function numeric(a: unknown, b: unknown): [Decimal, Decimal] | null {
  try {
    const left = new Decimal(typeof a === "boolean" ? Number(a) : (a as string | number));
    const right = new Decimal(typeof b === "boolean" ? Number(b) : (b as string | number));
    if (!left.isFinite() || !right.isFinite()) return null;
    return [left, right];
  } catch {
    return null;
  }
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).toLowerCase();
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => text(entry));
  // A comma-separated string is what the editor produces for "is one of".
  return text(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Evaluate one condition against the facts. An unknown operator never matches. */
export function evaluate(condition: Condition, facts: Facts): boolean {
  const actual = Object.prototype.hasOwnProperty.call(facts, condition.field)
    ? facts[condition.field]
    : null;

  switch (condition.operator) {
    case "is_empty":
      return isBlank(actual);
    case "is_not_empty":
      return !isBlank(actual);

    case "eq": {
      const pair = numeric(actual, condition.value);
      return pair ? pair[0].equals(pair[1]) : text(actual) === text(condition.value);
    }
    case "ne": {
      const pair = numeric(actual, condition.value);
      return pair ? !pair[0].equals(pair[1]) : text(actual) !== text(condition.value);
    }

    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const pair = numeric(actual, condition.value);
      // A non-numeric comparison is not "false because smaller" — it is a rule
      // that cannot be answered, so it does not match.
      if (!pair) return false;
      const [left, right] = pair;
      if (condition.operator === "gt") return left.greaterThan(right);
      if (condition.operator === "gte") return left.greaterThanOrEqualTo(right);
      if (condition.operator === "lt") return left.lessThan(right);
      return left.lessThanOrEqualTo(right);
    }

    case "contains":
      return text(actual).includes(text(condition.value));
    case "not_contains":
      return !text(actual).includes(text(condition.value));

    case "in":
      return list(condition.value).includes(text(actual));
    case "not_in":
      return !list(condition.value).includes(text(actual));

    default:
      return false;
  }
}

/** Every condition must hold. No conditions means the rule always matches. */
export function matches(conditions: readonly Condition[], facts: Facts): boolean {
  return conditions.every((condition) => evaluate(condition, facts));
}
