import type { Rational } from "./contracts";
const LIMIT = 120;
function integer(s: string): bigint {
  if (typeof s !== "string" || !/^(0|[1-9][0-9]*)$/.test(s) || s.length > LIMIT) throw Error("Bounded nonnegative integer required");

  return BigInt(s);
}
function gcd(a: bigint, b: bigint): bigint {
  while (b) {
    const next = a % b;

    a = b;

    b = next;
  }

  return a;
}
export function fraction(n: bigint | string, d: bigint | string = 1n): Rational {
  const a = integer(String(n)), b = integer(String(d));

  if (!b) throw Error("Zero denominator");

  const g = gcd(a, b);

  return { numerator: String(a / g), denominator: String(b / g) };
}
export function decimal(s: string): Rational {
  if (typeof s !== "string" || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(s) || s.length > 40) throw Error("Bounded unsigned decimal required");

  const [whole, part = ""] = s.split(".");

  return fraction(BigInt(whole! + part), 10n ** BigInt(part.length));
}
export const add = (a: Rational, b: Rational) => fraction(integer(a.numerator) * integer(b.denominator) + integer(b.numerator) * integer(a.denominator), integer(a.denominator) * integer(b.denominator));
export const multiply = (a: Rational, b: Rational) => fraction(integer(a.numerator) * integer(b.numerator), integer(a.denominator) * integer(b.denominator));
export const compare = (a: Rational, b: Rational) => {
  const x = integer(a.numerator) * integer(b.denominator), y = integer(b.numerator) * integer(a.denominator);

  return x < y ? -1 : x > y ? 1 : 0;
};
export function subtract(a: Rational, b: Rational): Rational {
  if (compare(a, b) < 0) throw Error("Negative quantity");

  return fraction(integer(a.numerator) * integer(b.denominator) - integer(b.numerator) * integer(a.denominator), integer(a.denominator) * integer(b.denominator));
}
export function roundUsage(q: Rational, increment: string, minimum: string): Rational {
  const step = integer(increment), min = integer(minimum), n = integer(q.numerator), d = integer(q.denominator);

  if (!step || !d) throw Error("Positive increment and denominator required");

  const rounded = ((n + d * step - 1n) / (d * step)) * step;

  return fraction(rounded < min ? min : rounded);
}
export function fromNumber(value: number): Rational {
  if (!Number.isSafeInteger(value) || value < 0) throw Error("Exact nonnegative safe integer required; no float-to-money conversion");

  return fraction(String(value));
}
export function rational(q: Rational): Rational {
  return fraction(q.numerator, q.denominator);
}
