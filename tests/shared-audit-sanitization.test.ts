import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { Prisma } from "../lib/generated/prisma/client.js";

process.env.DATABASE_URL ||= "postgresql://audit-test:audit-test@127.0.0.1:5432/audit-test";

const jiti = createJiti(import.meta.url);
const { sanitizeAuditData } = await jiti.import<typeof import("../lib/platform/shared-audit.ts")>("../lib/platform/shared-audit.ts");

test("audit sanitizer recognizes Prisma Decimal2 values without exposing their internals", () => {
  const amount = new Prisma.Decimal("173.49");

  assert.equal(amount.constructor.name, "Decimal2");
  assert.equal(sanitizeAuditData(amount), "173.49");
  assert.deepEqual(sanitizeAuditData({ amount }), { amount: "173.49" });
});

test("audit sanitizer converts unsupported JavaScript values to JSON-safe markers", () => {
  const sparseValues = Array(2);
  sparseValues[1] = undefined;

  const sanitized = sanitizeAuditData({
    missing: undefined,
    callback: () => "not serialized",
    marker: Symbol("not serialized"),
    largeInteger: BigInt("9007199254740993"),
    notANumber: Number.NaN,
    positiveInfinity: Number.POSITIVE_INFINITY,
    negativeInfinity: Number.NEGATIVE_INFINITY,
    sparseValues,
    validDate: new Date("2026-07-21T00:00:00.000Z"),
    invalidDate: new Date(Number.NaN),
  });

  assert.deepEqual(sanitized, {
    missing: "[UNDEFINED]",
    callback: "[FUNCTION]",
    marker: "[SYMBOL]",
    largeInteger: "[BIGINT:9007199254740993]",
    notANumber: "[NON_FINITE_NUMBER:NaN]",
    positiveInfinity: "[NON_FINITE_NUMBER:Infinity]",
    negativeInfinity: "[NON_FINITE_NUMBER:-Infinity]",
    sparseValues: ["[UNDEFINED]", "[UNDEFINED]"],
    validDate: "2026-07-21T00:00:00.000Z",
    invalidDate: "[INVALID_DATE]",
  });
  assert.doesNotThrow(() => JSON.stringify(sanitized));
});

test("audit sanitizer keeps sensitive-key redaction and depth limiting", () => {
  const sanitized = sanitizeAuditData({
    apiToken: new Prisma.Decimal("123.45"),
    nested: {
      originalFilename: "secret.pdf",
      level2: {
        level3: {
          level4: {
            level5: {
              level6: {
                level7: "must not be retained",
              },
            },
          },
        },
      },
    },
  });

  assert.deepEqual(sanitized, {
    apiToken: "[REDACTED]",
    nested: {
      originalFilename: "[REDACTED]",
      level2: {
        level3: {
          level4: {
            level5: {
              level6: {
                level7: "[TRUNCATED]",
              },
            },
          },
        },
      },
    },
  });
});
