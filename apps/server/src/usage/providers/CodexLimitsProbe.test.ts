import * as fs from "node:fs/promises";
import * as OS from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { probeCodexLimits } from "./CodexLimitsProbe";

const temporaryDirectories: Array<string> = [];

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(OS.tmpdir(), "capycode-codex-limits-"));
  temporaryDirectories.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("probeCodexLimits", () => {
  it("uses app-server limits when available", async () => {
    const fetchFn = vi.fn<typeof fetch>();

    const result = await probeCodexLimits({
      binaryPath: "codex",
      cwd: "/tmp/project",
      fetchFn,
      probeDiscovery: async () => ({
        account: {
          type: "chatgpt",
          planType: "plus",
          sparkEnabled: false,
        },
        skills: [],
        rateLimits: {
          primary: {
            used_percent: 42,
            window_minutes: 300,
            resets_at: "2026-04-12T05:00:00.000Z",
          },
          secondary: {
            used_percent: 63,
            window_minutes: 10_080,
            resets_at: "2026-04-18T00:00:00.000Z",
          },
        },
      }),
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.identity).toEqual({
      accountLabel: "ChatGPT plus",
      authLabel: "ChatGPT Plus Subscription",
    });
    expect(result.limits).toEqual([
      expect.objectContaining({
        kind: "rolling-5h",
        usedPercent: 42,
        source: "codex-app-server",
      }),
      expect.objectContaining({
        kind: "weekly",
        usedPercent: 63,
        source: "codex-app-server",
      }),
    ]);
  });

  it("falls back to Codex OAuth usage when app-server returns no windows", async () => {
    const homeDir = await makeTempDir();
    const authPath = path.join(homeDir, "auth.json");
    const configPath = path.join(homeDir, "config.toml");
    await fs.writeFile(
      authPath,
      JSON.stringify({
        tokens: {
          access_token: "codex-oauth-token",
          refresh_token: "codex-refresh-token",
          account_id: "workspace-123",
        },
      }),
      "utf8",
    );
    await fs.writeFile(configPath, 'chatgpt_base_url = "https://chatgpt.com/backend-api/"\n', "utf8");

    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          email: "roman@example.com",
          plan_type: "prolite",
          rate_limit: {
            primary_window: {
              used_percent: 18,
              limit_window_seconds: 18_000,
              reset_at: 1_776_069_077,
            },
            secondary_window: {
              used_percent: 37,
              limit_window_seconds: 604_800,
              reset_at: 1_776_364_479,
            },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const result = await probeCodexLimits({
      binaryPath: "codex",
      cwd: "/tmp/project",
      authPath,
      configPath,
      fetchFn,
      probeDiscovery: async () => ({
        account: {
          type: "chatgpt",
          planType: "plus",
          sparkEnabled: false,
        },
        skills: [],
        rateLimits: {},
      }),
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result.identity).toEqual({
      accountLabel: "ChatGPT Plus",
      authLabel: "roman@example.com",
    });
    expect(result.limits).toEqual([
      expect.objectContaining({
        kind: "rolling-5h",
        usedPercent: 18,
        source: "codex-oauth-api",
      }),
      expect.objectContaining({
        kind: "weekly",
        usedPercent: 37,
        source: "codex-oauth-api",
      }),
    ]);
  });

  it("returns no limits when neither app-server nor OAuth credentials are available", async () => {
    const homeDir = await makeTempDir();
    const fetchFn = vi.fn<typeof fetch>();

    const result = await probeCodexLimits({
      binaryPath: "codex",
      cwd: "/tmp/project",
      authPath: path.join(homeDir, "missing-auth.json"),
      configPath: path.join(homeDir, "missing-config.toml"),
      fetchFn,
      probeDiscovery: async () => ({
        account: {
          type: "chatgpt",
          planType: "plus",
          sparkEnabled: false,
        },
        skills: [],
        rateLimits: {},
      }),
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.identity).toEqual({
      accountLabel: "ChatGPT plus",
      authLabel: "ChatGPT Plus Subscription",
    });
    expect(result.limits).toEqual([]);
  });
});
