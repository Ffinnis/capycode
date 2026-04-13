import { describe, expect, it } from "vitest";
import { Schema } from "effect";

import {
  ProjectListDirectoryInput,
  ProjectListDirectoryResult,
  ProjectReadFileInput,
  ProjectReadFileResult,
} from "./project";

const decodeProjectListDirectoryInput = Schema.decodeUnknownSync(ProjectListDirectoryInput);
const decodeProjectListDirectoryResult = Schema.decodeUnknownSync(ProjectListDirectoryResult);
const decodeProjectReadFileInput = Schema.decodeUnknownSync(ProjectReadFileInput);
const decodeProjectReadFileResult = Schema.decodeUnknownSync(ProjectReadFileResult);

describe("ProjectListDirectoryInput", () => {
  it("accepts omitted relativePath for the workspace root", () => {
    const parsed = decodeProjectListDirectoryInput({
      cwd: "/repo",
    });

    expect(parsed.cwd).toBe("/repo");
    expect(parsed.relativePath).toBeUndefined();
  });
});

describe("ProjectListDirectoryResult", () => {
  it("decodes directory entries with explicit kinds", () => {
    const parsed = decodeProjectListDirectoryResult({
      entries: [
        {
          path: "src",
          name: "src",
          kind: "directory",
        },
        {
          path: "README.md",
          name: "README.md",
          kind: "file",
        },
      ],
    });

    expect(parsed.entries[0]?.kind).toBe("directory");
    expect(parsed.entries[1]?.path).toBe("README.md");
  });
});

describe("ProjectReadFileInput", () => {
  it("accepts explicit read limits for previews", () => {
    const parsed = decodeProjectReadFileInput({
      cwd: "/repo",
      relativePath: "src/index.ts",
      maxBytes: 262144,
    });

    expect(parsed.maxBytes).toBe(262144);
  });
});

describe("ProjectReadFileResult", () => {
  it("decodes text previews and unsupported states", () => {
    const text = decodeProjectReadFileResult({
      relativePath: "src/index.ts",
      kind: "text",
      contents: "export const ok = true;\n",
      sizeBytes: 24,
      truncated: false,
    });
    const tooLarge = decodeProjectReadFileResult({
      relativePath: "fixtures/large.log",
      kind: "too_large",
      sizeBytes: 300000,
      truncated: true,
    });

    expect(text.contents).toContain("ok");
    expect(tooLarge.kind).toBe("too_large");
    expect(tooLarge.truncated).toBe(true);
  });
});
