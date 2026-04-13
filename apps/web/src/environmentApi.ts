import type { EnvironmentId, EnvironmentApi } from "@capycode/contracts";

import type { WsRpcClient } from "./rpc/wsRpcClient";
import { readEnvironmentConnection } from "./environments/runtime";

export function createEnvironmentApi(rpcClient: WsRpcClient): EnvironmentApi {
  return {
    terminal: {
      open: (input) => rpcClient.terminal.open(input as never),
      write: (input) => rpcClient.terminal.write(input as never),
      resize: (input) => rpcClient.terminal.resize(input as never),
      clear: (input) => rpcClient.terminal.clear(input as never),
      restart: (input) => rpcClient.terminal.restart(input as never),
      close: (input) => rpcClient.terminal.close(input as never),
      onEvent: (callback) => rpcClient.terminal.onEvent(callback),
    },
    projects: {
      listDirectory: rpcClient.projects.listDirectory,
      readFile: rpcClient.projects.readFile,
      searchEntries: rpcClient.projects.searchEntries,
      writeFile: rpcClient.projects.writeFile,
    },
    workspaces: {
      create: rpcClient.workspaces.create,
      update: rpcClient.workspaces.update,
      setActive: rpcClient.workspaces.setActive,
      getDeletePreview: rpcClient.workspaces.getDeletePreview,
      delete: async (input) => {
        await rpcClient.workspaces.delete(input);
      },
      listOpenCandidates: rpcClient.workspaces.listOpenCandidates,
      openMainRepo: rpcClient.workspaces.openMainRepo,
      openTrackedWorktree: rpcClient.workspaces.openTrackedWorktree,
      openExternalWorktree: rpcClient.workspaces.openExternalWorktree,
      importAll: (input) =>
        rpcClient.workspaces.importAll(input).then((workspaces) => [...workspaces]),
      createSection: rpcClient.workspaces.createSection,
      renameSection: rpcClient.workspaces.renameSection,
      deleteSection: async (input) => {
        await rpcClient.workspaces.deleteSection(input);
      },
      setSectionColor: rpcClient.workspaces.setSectionColor,
      toggleSectionCollapsed: rpcClient.workspaces.toggleSectionCollapsed,
      reorderProjectChildren: async (input) => {
        await rpcClient.workspaces.reorderProjectChildren(input);
      },
      reorderSectionWorkspaces: async (input) => {
        await rpcClient.workspaces.reorderSectionWorkspaces(input);
      },
      moveToSection: rpcClient.workspaces.moveToSection,
    },
    git: {
      pull: rpcClient.git.pull,
      refreshStatus: rpcClient.git.refreshStatus,
      onStatus: (input, callback, options) => rpcClient.git.onStatus(input, callback, options),
      listBranches: rpcClient.git.listBranches,
      getReviewStatus: rpcClient.git.getReviewStatus,
      listCommits: rpcClient.git.listCommits,
      getCommitFiles: rpcClient.git.getCommitFiles,
      getFileDiff: rpcClient.git.getFileDiff,
      createWorktree: rpcClient.git.createWorktree,
      removeWorktree: rpcClient.git.removeWorktree,
      createBranch: rpcClient.git.createBranch,
      checkout: rpcClient.git.checkout,
      init: rpcClient.git.init,
      resolvePullRequest: rpcClient.git.resolvePullRequest,
      preparePullRequestThread: rpcClient.git.preparePullRequestThread,
    },
    orchestration: {
      getSnapshot: rpcClient.orchestration.getSnapshot,
      dispatchCommand: rpcClient.orchestration.dispatchCommand,
      getTurnDiff: rpcClient.orchestration.getTurnDiff,
      getFullThreadDiff: rpcClient.orchestration.getFullThreadDiff,
      replayEvents: (fromSequenceExclusive) =>
        rpcClient.orchestration
          .replayEvents({ fromSequenceExclusive })
          .then((events) => [...events]),
      onDomainEvent: (callback, options) =>
        rpcClient.orchestration.onDomainEvent(callback, options),
    },
  };
}

export function readEnvironmentApi(environmentId: EnvironmentId): EnvironmentApi | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  if (!environmentId) {
    return undefined;
  }

  const connection = readEnvironmentConnection(environmentId);
  return connection ? createEnvironmentApi(connection.client) : undefined;
}

export function ensureEnvironmentApi(environmentId: EnvironmentId): EnvironmentApi {
  const api = readEnvironmentApi(environmentId);
  if (!api) {
    throw new Error(`Environment API not found for environment ${environmentId}`);
  }
  return api;
}
