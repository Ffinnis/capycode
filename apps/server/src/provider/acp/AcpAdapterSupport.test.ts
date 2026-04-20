import { describe, expect, it } from "vitest";
import * as EffectAcpErrors from "effect-acp/errors";

import { acpPermissionOutcome, mapAcpToAdapterError } from "./AcpAdapterSupport.ts";

describe("AcpAdapterSupport", () => {
  it("maps ACP approval decisions to permission outcomes", () => {
    expect(acpPermissionOutcome("accept")).toBe("allow-once");
    expect(acpPermissionOutcome("acceptForSession")).toBe("allow-always");
    expect(acpPermissionOutcome("decline")).toBe("reject-once");
  });

  it("maps ACP request errors to provider adapter request errors", () => {
    const error = mapAcpToAdapterError(
      "cursor",
      "thread-1" as never,
      "session/prompt",
      new EffectAcpErrors.AcpRequestError({
        code: -32602,
        errorMessage: "Invalid params",
      }),
    );

    expect(error._tag).toBe("ProviderAdapterRequestError");
    expect(error.message).toContain("Invalid params");
  });

  it("maps ACP process exited errors to provider adapter session closed errors", () => {
    const error = mapAcpToAdapterError(
      "cursor",
      "thread-1" as never,
      "session/prompt",
      new EffectAcpErrors.AcpProcessExitedError({ code: 1 }),
    );

    expect(error._tag).toBe("ProviderAdapterSessionClosedError");
  });
});
