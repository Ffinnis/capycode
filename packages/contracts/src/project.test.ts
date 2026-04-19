import { describe, expect, it } from "vitest";
import { Schema } from "effect";

import {
  ProjectCreateDirectoryInput,
  ProjectDeleteEntryInput,
  ProjectListDirectoryInput,
  ProjectListDirectoryResult,
  ProjectMoveEntryInput,
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectWriteFileInput,
} from "./project";

const decodeProjectCreateDirectoryInput = Schema.decodeUnknownSync(ProjectCreateDirectoryInput);
const decodeProjectDeleteEntryInput = Schema.decodeUnknownSync(ProjectDeleteEntryInput);
const decodeProjectListDirectoryInput = Schema.decodeUnknownSync(ProjectListDirectoryInput);
const decodeProjectListDirectoryResult = Schema.decodeUnknownSync(ProjectListDirectoryResult);
const decodeProjectMoveEntryInput = Schema.decodeUnknownSync(ProjectMoveEntryInput);
const decodeProjectReadFileInput = Schema.decodeUnknownSync(ProjectReadFileInput);
const decodeProjectReadFileResult = Schema.decodeUnknownSync(ProjectReadFileResult);
const decodeProjectWriteFileInput = Schema.decodeUnknownSync(ProjectWriteFileInput);

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
      encoding: "utf8",
      lineEnding: "lf",
      versionToken: "sha256:123",
      sizeBytes: 24,
      lastModifiedMs: 1713200000000,
      truncated: false,
    });
    const tooLarge = decodeProjectReadFileResult({
      relativePath: "fixtures/large.log",
      kind: "too_large",
      sizeBytes: 300000,
      lastModifiedMs: 1713200001000,
      truncated: true,
    });

    expect(text.contents).toContain("ok");
    expect(text.versionToken).toBe("sha256:123");
    expect(tooLarge.kind).toBe("too_large");
    expect(tooLarge.truncated).toBe(true);
  });
});

describe("ProjectWriteFileInput", () => {
  it("accepts legacy writes without explicit conflict options", () => {
    const parsed = decodeProjectWriteFileInput({
      cwd: "/repo",
      relativePath: "src/index.ts",
      contents: "export const ok = true;\n",
    });

    expect(parsed.relativePath).toBe("src/index.ts");
    expect(parsed.encoding).toBeUndefined();
    expect(parsed.createParents).toBeUndefined();
    expect(parsed.overwrite).toBeUndefined();
  });

  it("accepts binary uploads and version-aware writes", () => {
    const parsed = decodeProjectWriteFileInput({
      cwd: "/repo",
      relativePath: "assets/logo.png",
      contents: "aGVsbG8=",
      encoding: "base64",
      overwrite: true,
      expectedVersionToken: "sha256:prev",
      createParents: false,
    });

    expect(parsed.encoding).toBe("base64");
    expect(parsed.expectedVersionToken).toBe("sha256:prev");
    expect(parsed.createParents).toBe(false);
    expect(parsed.overwrite).toBe(true);
  });
});

describe("ProjectCreateDirectoryInput", () => {
  it("accepts omitted overwrite", () => {
    const parsed = decodeProjectCreateDirectoryInput({
      cwd: "/repo",
      relativePath: "src/components",
    });

    expect(parsed.overwrite).toBeUndefined();
  });
});

describe("ProjectDeleteEntryInput", () => {
  it("accepts recursive directory deletion hints", () => {
    const parsed = decodeProjectDeleteEntryInput({
      cwd: "/repo",
      relativePath: "src/components",
      recursive: true,
      expectedKind: "directory",
    });

    expect(parsed.recursive).toBe(true);
    expect(parsed.expectedKind).toBe("directory");
  });
});

describe("ProjectMoveEntryInput", () => {
  it("accepts omitted overwrite for moves", () => {
    const parsed = decodeProjectMoveEntryInput({
      cwd: "/repo",
      sourceRelativePath: "src/old.ts",
      destinationRelativePath: "src/new.ts",
    });

    expect(parsed.overwrite).toBeUndefined();
    expect(parsed.destinationRelativePath).toBe("src/new.ts");
  });
});
