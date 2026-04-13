import { describe, expect, it } from "vitest";

import { parseDiffRouteSearch, stripDiffSearchParams } from "./diffRouteSearch";

describe("parseDiffRouteSearch", () => {
  it("parses valid diff search values", () => {
    const parsed = parseDiffRouteSearch({
      diff: "1",
      diffTurnId: "turn-1",
      diffFilePath: "src/app.ts",
    });

    expect(parsed).toEqual({
      diff: "1",
      diffTurnId: "turn-1",
      diffFilePath: "src/app.ts",
    });
  });

  it("treats numeric and boolean diff toggles as open", () => {
    expect(
      parseDiffRouteSearch({
        diff: 1,
        diffTurnId: "turn-1",
      }),
    ).toEqual({
      diff: "1",
      diffTurnId: "turn-1",
    });

    expect(
      parseDiffRouteSearch({
        diff: true,
        diffTurnId: "turn-1",
      }),
    ).toEqual({
      diff: "1",
      diffTurnId: "turn-1",
    });
  });

  it("drops turn and file values when diff is closed", () => {
    const parsed = parseDiffRouteSearch({
      diff: "0",
      files: "1",
      terminal: "1",
      diffTurnId: "turn-1",
      diffFilePath: "src/app.ts",
      file: "src/file.ts",
    });

    expect(parsed).toEqual({
      files: "1",
      terminal: "1",
      file: "src/file.ts",
    });
  });

  it("drops file value when turn is not selected", () => {
    const parsed = parseDiffRouteSearch({
      diff: "1",
      diffFilePath: "src/app.ts",
    });

    expect(parsed).toEqual({
      diff: "1",
    });
  });

  it("normalizes whitespace-only values", () => {
    const parsed = parseDiffRouteSearch({
      diff: "1",
      files: "1",
      terminal: "1",
      diffTurnId: "  ",
      diffFilePath: "  ",
      file: "  ",
    });

    expect(parsed).toEqual({
      diff: "1",
      files: "1",
      terminal: "1",
    });
  });

  it("parses terminal surface search values", () => {
    const parsed = parseDiffRouteSearch({
      terminal: true,
      file: "src/file.ts",
    });

    expect(parsed).toEqual({
      terminal: "1",
      file: "src/file.ts",
    });
  });
});

describe("stripDiffSearchParams", () => {
  it("removes terminal and workspace surface params", () => {
    expect(
      stripDiffSearchParams({
        q: "keep",
        diff: "1",
        files: "1",
        terminal: "1",
        diffTurnId: "turn-1",
        diffFilePath: "src/app.ts",
        file: "src/file.ts",
      }),
    ).toEqual({
      q: "keep",
    });
  });
});
