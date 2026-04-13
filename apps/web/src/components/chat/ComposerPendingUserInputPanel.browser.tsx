import "../../index.css";

import { ApprovalRequestId } from "@capycode/contracts";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ComposerPendingUserInputPanel } from "./ComposerPendingUserInputPanel";

describe("ComposerPendingUserInputPanel", () => {
  const createdAt = "2026-01-01T00:00:00.000Z";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("auto-advances after a single-select answer", async () => {
    const onToggleOption = vi.fn();
    const onAdvance = vi.fn();

    await render(
      <ComposerPendingUserInputPanel
        pendingUserInputs={[
          {
            requestId: ApprovalRequestId.make("req-user-input-1"),
            createdAt,
            questions: [
              {
                header: "Scope",
                id: "scope",
                question: "Which scope should be allowed?",
                options: [
                  {
                    label: "Workspace only",
                    description: "Allow access to the current workspace only.",
                  },
                  {
                    label: "All request methods",
                    description: "Allow the full request surface.",
                  },
                ],
                multiSelect: false,
              },
            ],
          },
        ]}
        respondingRequestIds={[]}
        answers={{}}
        questionIndex={0}
        onToggleOption={onToggleOption}
        onAdvance={onAdvance}
      />,
    );

    await page.getByRole("button", { name: /Workspace only/i }).click();

    expect(onToggleOption).toHaveBeenCalledWith("scope", "Workspace only");
    await vi.advanceTimersByTimeAsync(250);
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it("supports keyboard shortcuts without auto-advancing multi-select prompts", async () => {
    const onToggleOption = vi.fn();
    const onAdvance = vi.fn();

    await render(
      <ComposerPendingUserInputPanel
        pendingUserInputs={[
          {
            requestId: ApprovalRequestId.make("req-user-input-2"),
            createdAt,
            questions: [
              {
                header: "Methods",
                id: "methods",
                question: "Which methods should stay enabled?",
                options: [
                  {
                    label: "Read files",
                    description: "Allow read-only inspection.",
                  },
                  {
                    label: "Write files",
                    description: "Allow editing and file creation.",
                  },
                ],
                multiSelect: true,
              },
            ],
          },
        ]}
        respondingRequestIds={[]}
        answers={{}}
        questionIndex={0}
        onToggleOption={onToggleOption}
        onAdvance={onAdvance}
      />,
    );

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "2",
        bubbles: true,
      }),
    );

    expect(onToggleOption).toHaveBeenCalledWith("methods", "Write files");
    await vi.advanceTimersByTimeAsync(250);
    expect(onAdvance).not.toHaveBeenCalled();
  });
});
