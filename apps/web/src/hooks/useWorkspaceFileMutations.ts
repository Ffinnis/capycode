import { type EnvironmentId } from "@capycode/contracts";
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toastManager } from "~/components/ui/toast";
import { ensureLocalApi } from "~/localApi";
import { readEnvironmentApi } from "~/environmentApi";
import {
  invalidateProjectListDirectory,
  invalidateProjectReadFile,
  invalidateProjectSearchEntries,
} from "~/lib/projectReactQuery";
import { useWorkspaceDockStore } from "~/workspaceDockStore";
import { useWorkspaceEditorStore } from "~/workspaceEditorStore";

function parentPathOf(relativePath: string): string | undefined {
  const index = relativePath.lastIndexOf("/");
  return index === -1 ? undefined : relativePath.slice(0, index);
}

function joinRelativePath(
  parentRelativePath: string | undefined,
  childRelativePath: string,
): string {
  return parentRelativePath ? `${parentRelativePath}/${childRelativePath}` : childRelativePath;
}

function getErrorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected workspace file error.";
}

function listDirectoryInvalidationInput(
  environmentId: EnvironmentId | null,
  cwd: string | null,
  relativePath?: string,
) {
  return relativePath ? { environmentId, cwd, relativePath } : { environmentId, cwd };
}

export function useWorkspaceFileMutations(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  scopeKey: string | null;
}) {
  const queryClient = useQueryClient();
  const renameFileTab = useWorkspaceDockStore((state) => state.renameFileTab);
  const closeFileTab = useWorkspaceDockStore((state) => state.closeFileTab);
  const closeFileTabsByPrefix = useWorkspaceDockStore((state) => state.closeFileTabsByPrefix);
  const renameBuffer = useWorkspaceEditorStore((state) => state.renameBuffer);
  const removeBuffer = useWorkspaceEditorStore((state) => state.removeBuffer);
  const removeBuffersByPrefix = useWorkspaceEditorStore((state) => state.removeBuffersByPrefix);

  const chooseAction = useCallback(
    async <T extends string>(
      items: ReadonlyArray<{ id: T; label: string; destructive?: boolean; disabled?: boolean }>,
    ): Promise<T | null> => {
      const api = ensureLocalApi();
      return api.contextMenu.show(items, {
        x: Math.round(window.innerWidth / 2 - 96),
        y: Math.round(window.innerHeight / 2 - 48),
      });
    },
    [],
  );

  const invalidatePath = useCallback(
    async (relativePath: string, options?: { created?: boolean }) => {
      if (!input.cwd) return;
      const invalidations = [
        invalidateProjectReadFile(queryClient, {
          environmentId: input.environmentId,
          cwd: input.cwd,
          relativePath,
        }),
      ];
      if (options?.created) {
        invalidations.push(
          invalidateProjectListDirectory(queryClient, {
            ...listDirectoryInvalidationInput(
              input.environmentId,
              input.cwd,
              parentPathOf(relativePath),
            ),
          }),
        );
        invalidations.push(
          invalidateProjectSearchEntries(queryClient, input.environmentId, input.cwd),
        );
      }
      await Promise.all(invalidations);
    },
    [input.cwd, input.environmentId, queryClient],
  );

  const writeFile = useCallback(
    async (params: {
      relativePath: string;
      contents: string;
      encoding?: "utf8" | "base64";
      overwrite?: boolean;
      expectedVersionToken?: string;
      createParents?: boolean;
    }) => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Workspace file writes are unavailable.");
      }
      const api = readEnvironmentApi(input.environmentId);
      if (!api) {
        throw new Error("Environment API is unavailable.");
      }

      const result = await api.projects.writeFile({
        cwd: input.cwd,
        relativePath: params.relativePath,
        contents: params.contents,
        ...(params.encoding ? { encoding: params.encoding } : {}),
        ...(params.overwrite !== undefined ? { overwrite: params.overwrite } : {}),
        ...(params.expectedVersionToken
          ? { expectedVersionToken: params.expectedVersionToken }
          : {}),
        ...(params.createParents !== undefined ? { createParents: params.createParents } : {}),
      });
      await invalidatePath(params.relativePath, { created: result.created });
      return result;
    },
    [input.cwd, input.environmentId, invalidatePath],
  );

  const createDirectory = useCallback(
    async (relativePath: string) => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Workspace directory creation is unavailable.");
      }
      const api = readEnvironmentApi(input.environmentId);
      if (!api) {
        throw new Error("Environment API is unavailable.");
      }
      const result = await api.projects.createDirectory({
        cwd: input.cwd,
        relativePath,
      });
      await invalidateProjectListDirectory(
        queryClient,
        listDirectoryInvalidationInput(input.environmentId, input.cwd, parentPathOf(relativePath)),
      );
      await invalidateProjectSearchEntries(queryClient, input.environmentId, input.cwd);
      return result;
    },
    [input.cwd, input.environmentId, queryClient],
  );

  const deleteEntry = useCallback(
    async (params: {
      relativePath: string;
      expectedKind?: "file" | "directory";
      recursive?: boolean;
    }) => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Workspace deletion is unavailable.");
      }
      const api = readEnvironmentApi(input.environmentId);
      if (!api) {
        throw new Error("Environment API is unavailable.");
      }
      const result = await api.projects.deleteEntry({
        cwd: input.cwd,
        relativePath: params.relativePath,
        ...(params.expectedKind ? { expectedKind: params.expectedKind } : {}),
        ...(params.recursive !== undefined ? { recursive: params.recursive } : {}),
      });

      await Promise.all([
        invalidateProjectListDirectory(queryClient, {
          ...listDirectoryInvalidationInput(
            input.environmentId,
            input.cwd,
            parentPathOf(params.relativePath),
          ),
        }),
        invalidateProjectReadFile(queryClient, {
          environmentId: input.environmentId,
          cwd: input.cwd,
          relativePath: params.relativePath,
        }),
        invalidateProjectSearchEntries(queryClient, input.environmentId, input.cwd),
      ]);

      if (input.scopeKey) {
        if (params.expectedKind === "directory") {
          closeFileTabsByPrefix(input.scopeKey, params.relativePath);
          removeBuffersByPrefix(input.scopeKey, params.relativePath);
        } else {
          closeFileTab(input.scopeKey, params.relativePath);
          removeBuffer(input.scopeKey, params.relativePath);
        }
      }

      return result;
    },
    [
      closeFileTab,
      closeFileTabsByPrefix,
      input.cwd,
      input.environmentId,
      input.scopeKey,
      queryClient,
      removeBuffer,
      removeBuffersByPrefix,
    ],
  );

  const moveEntry = useCallback(
    async (params: {
      sourceRelativePath: string;
      destinationRelativePath: string;
      overwrite?: boolean;
    }) => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Workspace move is unavailable.");
      }
      const api = readEnvironmentApi(input.environmentId);
      if (!api) {
        throw new Error("Environment API is unavailable.");
      }
      const result = await api.projects.moveEntry({
        cwd: input.cwd,
        sourceRelativePath: params.sourceRelativePath,
        destinationRelativePath: params.destinationRelativePath,
        ...(params.overwrite !== undefined ? { overwrite: params.overwrite } : {}),
      });

      await Promise.all([
        invalidateProjectListDirectory(queryClient, {
          ...listDirectoryInvalidationInput(
            input.environmentId,
            input.cwd,
            parentPathOf(params.sourceRelativePath),
          ),
        }),
        invalidateProjectListDirectory(queryClient, {
          ...listDirectoryInvalidationInput(
            input.environmentId,
            input.cwd,
            parentPathOf(params.destinationRelativePath),
          ),
        }),
        invalidateProjectReadFile(queryClient, {
          environmentId: input.environmentId,
          cwd: input.cwd,
          relativePath: params.sourceRelativePath,
        }),
        invalidateProjectReadFile(queryClient, {
          environmentId: input.environmentId,
          cwd: input.cwd,
          relativePath: params.destinationRelativePath,
        }),
        invalidateProjectSearchEntries(queryClient, input.environmentId, input.cwd),
      ]);

      if (input.scopeKey) {
        renameFileTab(input.scopeKey, params.sourceRelativePath, params.destinationRelativePath);
        renameBuffer(input.scopeKey, params.sourceRelativePath, params.destinationRelativePath);
      }

      return result;
    },
    [input.cwd, input.environmentId, input.scopeKey, queryClient, renameBuffer, renameFileTab],
  );

  const uploadFiles = useCallback(
    async (
      destinationRelativePath: string | undefined,
      files: ReadonlyArray<{
        relativePath: string;
        file: File;
      }>,
    ) => {
      for (const file of files) {
        const bytes = new Uint8Array(await file.file.arrayBuffer());
        let binary = "";
        for (const chunk of bytes) {
          binary += String.fromCharCode(chunk);
        }
        const contents = btoa(binary);
        const targetRelativePath = joinRelativePath(destinationRelativePath, file.relativePath);

        try {
          await writeFile({
            relativePath: targetRelativePath,
            contents,
            encoding: "base64",
          });
        } catch (error) {
          if (getErrorCode(error) === "already_exists") {
            const action = await chooseAction([
              { id: "overwrite", label: "Overwrite" },
              { id: "skip", label: "Skip" },
              { id: "cancel", label: "Cancel batch", destructive: true },
            ]);
            if (action === "skip") {
              continue;
            }
            if (action !== "overwrite") {
              break;
            }
            await writeFile({
              relativePath: targetRelativePath,
              contents,
              encoding: "base64",
              overwrite: true,
            });
            continue;
          }

          toastManager.add({
            type: "error",
            title: "Upload failed",
            description: getErrorMessage(error),
          });
          throw error;
        }
      }
    },
    [chooseAction, writeFile],
  );

  return {
    writeFile,
    createDirectory,
    deleteEntry,
    moveEntry,
    uploadFiles,
  };
}
