import { test, expect, describe } from "bun:test";
import { uuidSchema, optionalUuidSchema } from "../registry";

describe("uuidSchema", () => {
  test("accepts dashed UUID and strips dashes", () => {
    const result = uuidSchema.parse("550e8400-e29b-41d4-a716-446655440000");
    expect(result).toBe("550e8400e29b41d4a716446655440000");
  });

  test("lowercases UUID", () => {
    const result = uuidSchema.parse("550E8400-E29B-41D4-A716-446655440000");
    expect(result).toBe("550e8400e29b41d4a716446655440000");
  });

  test("rejects non-UUID strings", () => {
    expect(() => uuidSchema.parse("not-a-uuid")).toThrow();
  });
});

describe("optionalUuidSchema", () => {
  test("returns undefined when not provided", () => {
    const result = optionalUuidSchema.parse(undefined);
    expect(result).toBeUndefined();
  });

  test("strips dashes when provided", () => {
    const result = optionalUuidSchema.parse("550e8400-e29b-41d4-a716-446655440000");
    expect(result).toBe("550e8400e29b41d4a716446655440000");
  });
});
