import { describe, expect, it } from "vitest";
import { acceptsCurrentDemoTerms, canRenderDemoSignup, DEMO_TERMS_VERSION } from "./demoTerms";

describe("controlled demo terms", () => {
  it("rejects absent or stale acceptance", () => {
    expect(acceptsCurrentDemoTerms(null)).toBe(false);
    expect(acceptsCurrentDemoTerms("roomscout-demo-terms-old")).toBe(false);
    expect(canRenderDemoSignup(undefined)).toBe(false);
    expect(canRenderDemoSignup("roomscout-demo-terms-old")).toBe(false);
  });

  it("accepts only the exact current version", () => {
    expect(acceptsCurrentDemoTerms(DEMO_TERMS_VERSION)).toBe(true);
    expect(canRenderDemoSignup(DEMO_TERMS_VERSION)).toBe(true);
  });
});
