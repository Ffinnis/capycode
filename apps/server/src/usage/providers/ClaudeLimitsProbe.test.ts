import * as fs from "node:fs/promises";
import * as OS from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { probeClaudeLimits } from "./ClaudeLimitsProbe";

const temporaryDirectories: Array<string> = [];

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(OS.tmpdir(), "capycode-claude-limits-"));
  temporaryDirectories.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("probeClaudeLimits", () => {
  it("reads Claude OAuth credentials from the macOS keychain payload", async () => {
    const homeDir = await makeTempDir();
    await fs.writeFile(
      path.join(homeDir, ".claude.json"),
      JSON.stringify({
        oauthAccount: {
          emailAddress: "roman@example.com",
          displayName: "Roman",
        },
      }),
      "utf8",
    );

    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          five_hour: { utilization: 12.5, resets_at: "2026-04-12T05:00:00.000Z" },
          seven_day: { utilization: 30, resets_at: "2026-04-18T00:00:00.000Z" },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const result = await probeClaudeLimits({
      fetchFn,
      homeDir,
      platform: "darwin",
      readKeychainSecret: () =>
        JSON.stringify({
          claudeAiOauth: {
            accessToken: "sk-ant-oat01-test-token",
            scopes: ["user:profile", "user:inference"],
            subscriptionType: "max",
            rateLimitTier: "default_claude_max_5x",
          },
        }),
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result.identity).toEqual({
      accountLabel: "Claude Max",
      authLabel: "roman@example.com",
    });
    expect(result.limits).toEqual([
      expect.objectContaining({
        kind: "rolling-5h",
        usedPercent: 12.5,
        source: "claude-oauth-api",
      }),
      expect.objectContaining({
        kind: "weekly",
        usedPercent: 30,
        source: "claude-oauth-api",
      }),
    ]);
  });

  it("falls back to ~/.claude/.credentials.json when keychain access is unavailable", async () => {
    const homeDir = await makeTempDir();
    await fs.mkdir(path.join(homeDir, ".claude"), { recursive: true });
    await fs.writeFile(
      path.join(homeDir, ".claude", ".credentials.json"),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "sk-ant-oat01-file-token",
          scopes: ["user:profile"],
          subscriptionType: "pro",
        },
      }),
      "utf8",
    );

    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          five_hour: { utilization: 9, resets_at: "2026-04-12T05:00:00.000Z" },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const result = await probeClaudeLimits({
      fetchFn,
      homeDir,
      platform: "linux",
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result.identity.accountLabel).toBe("Claude Pro");
    expect(result.limits).toEqual([
      expect.objectContaining({
        kind: "rolling-5h",
        usedPercent: 9,
      }),
    ]);
  });

  it("returns no limits when no usable Claude OAuth credentials are available", async () => {
    const homeDir = await makeTempDir();
    const fetchFn = vi.fn<typeof fetch>();

    const result = await probeClaudeLimits({
      fetchFn,
      homeDir,
      platform: "linux",
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.limits).toEqual([]);
    expect(result.identity).toEqual({
      accountLabel: null,
      authLabel: null,
    });
  });
});
