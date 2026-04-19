import { describe, expect, it } from "vitest";

import { normalizeLegacyProjectRpcPayload } from "./protocol";

describe("normalizeLegacyProjectRpcPayload", () => {
  it("adds a default code for legacy project error payloads", () => {
    const normalized = normalizeLegacyProjectRpcPayload({
      _tag: "Exit",
      requestId: "request-1",
      exit: {
        _tag: "Failure",
        cause: {
          _tag: "Fail",
          error: {
            _tag: "ProjectSearchEntriesError",
            message: "Workspace root does not exist",
          },
        },
      },
    });

    expect(normalized).toEqual({
      _tag: "Exit",
      requestId: "request-1",
      exit: {
        _tag: "Failure",
        cause: {
          _tag: "Fail",
          error: {
            _tag: "ProjectSearchEntriesError",
            code: "not_found",
            message: "Workspace root does not exist",
          },
        },
      },
    });
  });

  it("adds a default code for other legacy project error tags", () => {
    const normalized = normalizeLegacyProjectRpcPayload({
      _tag: "ProjectMoveEntryError",
      message: "Destination already exists",
    });

    expect(normalized).toEqual({
      _tag: "ProjectMoveEntryError",
      code: "not_found",
      message: "Destination already exists",
    });
  });

  it("preserves explicit project mutation codes", () => {
    const payload = {
      _tag: "ProjectSearchEntriesError",
      code: "outside_root",
      message: "Outside root",
    };

    expect(normalizeLegacyProjectRpcPayload(payload)).toBe(payload);
  });
});
