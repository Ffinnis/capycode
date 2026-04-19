import { describe, expect, it } from "vitest";

import { normalizeFileContents, serializeFileContents } from "./fileLineEndings";

describe("normalizeFileContents", () => {
  it("normalizes crlf endings to lf for the editor buffer", () => {
    expect(normalizeFileContents("one\r\ntwo\r\n")).toBe("one\ntwo\n");
  });
});

describe("serializeFileContents", () => {
  it("preserves lf endings for lf files", () => {
    expect(serializeFileContents("one\r\ntwo\n", "lf")).toBe("one\ntwo\n");
  });

  it("restores crlf endings for crlf files", () => {
    expect(serializeFileContents("one\ntwo\n", "crlf")).toBe("one\r\ntwo\r\n");
  });
});
