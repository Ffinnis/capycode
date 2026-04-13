import { describe, expect, it } from "vitest";

import { resolveWindowActivationAction } from "./windowActivation";

describe("resolveWindowActivationAction", () => {
  it("reuses an existing window when one is already open", () => {
    expect(
      resolveWindowActivationAction({
        hasExistingWindow: true,
        bootstrapWindowPending: true,
      }),
    ).toBe("reveal-existing-window");
  });

  it("waits for bootstrap when the initial startup window has not been created yet", () => {
    expect(
      resolveWindowActivationAction({
        hasExistingWindow: false,
        bootstrapWindowPending: true,
      }),
    ).toBe("wait-for-bootstrap");
  });

  it("creates a new window after bootstrap when none are open", () => {
    expect(
      resolveWindowActivationAction({
        hasExistingWindow: false,
        bootstrapWindowPending: false,
      }),
    ).toBe("create-window");
  });
});
