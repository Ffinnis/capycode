import { EnvironmentId } from "@capycode/contracts";
import { describe, expect, it } from "vitest";

import { resolveEnvironmentOptionLabel } from "./BranchToolbar.logic";

const localEnvironmentId = EnvironmentId.make("environment-local");
const remoteEnvironmentId = EnvironmentId.make("environment-remote");

describe("resolveEnvironmentOptionLabel", () => {
  it("prefers the primary environment's machine label", () => {
    expect(
      resolveEnvironmentOptionLabel({
        isPrimary: true,
        environmentId: localEnvironmentId,
        runtimeLabel: "Julius's Mac mini",
        savedLabel: "Local environment",
      }),
    ).toBe("Julius's Mac mini");
  });

  it("falls back to 'This device' for generic primary labels", () => {
    expect(
      resolveEnvironmentOptionLabel({
        isPrimary: true,
        environmentId: localEnvironmentId,
        runtimeLabel: "Local environment",
        savedLabel: "Local",
      }),
    ).toBe("This device");
  });

  it("keeps configured labels for non-primary environments", () => {
    expect(
      resolveEnvironmentOptionLabel({
        isPrimary: false,
        environmentId: remoteEnvironmentId,
        runtimeLabel: null,
        savedLabel: "Build box",
      }),
    ).toBe("Build box");
  });
});
