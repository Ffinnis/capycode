import {
  type GitActionProgressEvent,
  type GitRunStackedActionInput,
  type GitRunStackedActionResult,
  type GitStatusResult,
  type GitStatusStreamEvent,
  type LocalApi,
  ORCHESTRATION_WS_METHODS,
  type ServerSettingsPatch,
  type UsageRange,
  WS_METHODS,
} from "@capycode/contracts";
import { applyGitStatusStreamEvent } from "@capycode/shared/git";
import { Effect, Stream } from "effect";

import { type WsRpcProtocolClient } from "./protocol";
import { resetWsReconnectBackoff } from "./wsConnectionState";
import { WsTransport } from "./wsTransport";

type RpcTag = keyof WsRpcProtocolClient & string;
type RpcMethod<TTag extends RpcTag> = WsRpcProtocolClient[TTag];
type RpcInput<TTag extends RpcTag> = Parameters<RpcMethod<TTag>>[0];

interface StreamSubscriptionOptions {
  readonly onResubscribe?: () => void;
}

type RpcUnaryMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Effect.Effect<infer TSuccess, any, any>
    ? (input: RpcInput<TTag>) => Promise<TSuccess>
    : never;

type RpcUnaryNoArgMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Effect.Effect<infer TSuccess, any, any>
    ? () => Promise<TSuccess>
    : never;

type RpcStreamMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Stream.Stream<infer TEvent, any, any>
    ? (listener: (event: TEvent) => void, options?: StreamSubscriptionOptions) => () => void
    : never;

const DEFAULT_USAGE_RANGE: UsageRange = "30d";

interface GitRunStackedActionOptions {
  readonly onProgress?: (event: GitActionProgressEvent) => void;
}

export interface WsRpcClient {
  readonly dispose: () => Promise<void>;
  readonly reconnect: () => Promise<void>;
  readonly terminal: {
    readonly open: RpcUnaryMethod<typeof WS_METHODS.terminalOpen>;
    readonly write: RpcUnaryMethod<typeof WS_METHODS.terminalWrite>;
    readonly resize: RpcUnaryMethod<typeof WS_METHODS.terminalResize>;
    readonly clear: RpcUnaryMethod<typeof WS_METHODS.terminalClear>;
    readonly restart: RpcUnaryMethod<typeof WS_METHODS.terminalRestart>;
    readonly close: RpcUnaryMethod<typeof WS_METHODS.terminalClose>;
    readonly onEvent: RpcStreamMethod<typeof WS_METHODS.subscribeTerminalEvents>;
  };
  readonly projects: {
    readonly listDirectory: RpcUnaryMethod<typeof WS_METHODS.projectsListDirectory>;
    readonly readFile: RpcUnaryMethod<typeof WS_METHODS.projectsReadFile>;
    readonly searchEntries: RpcUnaryMethod<typeof WS_METHODS.projectsSearchEntries>;
    readonly writeFile: RpcUnaryMethod<typeof WS_METHODS.projectsWriteFile>;
  };
  readonly workspaces: {
    readonly create: RpcUnaryMethod<typeof WS_METHODS.workspacesCreate>;
    readonly update: RpcUnaryMethod<typeof WS_METHODS.workspacesUpdate>;
    readonly setActive: RpcUnaryMethod<typeof WS_METHODS.workspacesSetActive>;
    readonly getDeletePreview: RpcUnaryMethod<typeof WS_METHODS.workspacesGetDeletePreview>;
    readonly delete: RpcUnaryMethod<typeof WS_METHODS.workspacesDelete>;
    readonly listOpenCandidates: RpcUnaryMethod<typeof WS_METHODS.workspacesListOpenCandidates>;
    readonly openMainRepo: RpcUnaryMethod<typeof WS_METHODS.workspacesOpenMainRepo>;
    readonly openTrackedWorktree: RpcUnaryMethod<typeof WS_METHODS.workspacesOpenTrackedWorktree>;
    readonly openExternalWorktree: RpcUnaryMethod<typeof WS_METHODS.workspacesOpenExternalWorktree>;
    readonly importAll: RpcUnaryMethod<typeof WS_METHODS.workspacesImportAll>;
    readonly createSection: RpcUnaryMethod<typeof WS_METHODS.workspacesCreateSection>;
    readonly renameSection: RpcUnaryMethod<typeof WS_METHODS.workspacesRenameSection>;
    readonly deleteSection: RpcUnaryMethod<typeof WS_METHODS.workspacesDeleteSection>;
    readonly setSectionColor: RpcUnaryMethod<typeof WS_METHODS.workspacesSetSectionColor>;
    readonly toggleSectionCollapsed: RpcUnaryMethod<
      typeof WS_METHODS.workspacesToggleSectionCollapsed
    >;
    readonly reorderProjectChildren: RpcUnaryMethod<
      typeof WS_METHODS.workspacesReorderProjectChildren
    >;
    readonly reorderSectionWorkspaces: RpcUnaryMethod<
      typeof WS_METHODS.workspacesReorderSectionWorkspaces
    >;
    readonly moveToSection: RpcUnaryMethod<typeof WS_METHODS.workspacesMoveToSection>;
  };
  readonly shell: {
    readonly openInEditor: (input: {
      readonly cwd: Parameters<LocalApi["shell"]["openInEditor"]>[0];
      readonly editor: Parameters<LocalApi["shell"]["openInEditor"]>[1];
    }) => ReturnType<LocalApi["shell"]["openInEditor"]>;
  };
  readonly git: {
    readonly pull: RpcUnaryMethod<typeof WS_METHODS.gitPull>;
    readonly refreshStatus: RpcUnaryMethod<typeof WS_METHODS.gitRefreshStatus>;
    readonly onStatus: (
      input: RpcInput<typeof WS_METHODS.subscribeGitStatus>,
      listener: (status: GitStatusResult) => void,
      options?: StreamSubscriptionOptions,
    ) => () => void;
    readonly runStackedAction: (
      input: GitRunStackedActionInput,
      options?: GitRunStackedActionOptions,
    ) => Promise<GitRunStackedActionResult>;
    readonly listRepositories: RpcUnaryMethod<typeof WS_METHODS.gitListRepositories>;
    readonly listBranches: RpcUnaryMethod<typeof WS_METHODS.gitListBranches>;
    readonly getReviewStatus: RpcUnaryMethod<typeof WS_METHODS.gitGetReviewStatus>;
    readonly listCommits: RpcUnaryMethod<typeof WS_METHODS.gitListCommits>;
    readonly getCommitFiles: RpcUnaryMethod<typeof WS_METHODS.gitGetCommitFiles>;
    readonly getFileDiff: RpcUnaryMethod<typeof WS_METHODS.gitGetFileDiff>;
    readonly createWorktree: RpcUnaryMethod<typeof WS_METHODS.gitCreateWorktree>;
    readonly removeWorktree: RpcUnaryMethod<typeof WS_METHODS.gitRemoveWorktree>;
    readonly createBranch: RpcUnaryMethod<typeof WS_METHODS.gitCreateBranch>;
    readonly checkout: RpcUnaryMethod<typeof WS_METHODS.gitCheckout>;
    readonly init: RpcUnaryMethod<typeof WS_METHODS.gitInit>;
    readonly resolvePullRequest: RpcUnaryMethod<typeof WS_METHODS.gitResolvePullRequest>;
    readonly preparePullRequestThread: RpcUnaryMethod<
      typeof WS_METHODS.gitPreparePullRequestThread
    >;
  };
  readonly server: {
    readonly getConfig: RpcUnaryNoArgMethod<typeof WS_METHODS.serverGetConfig>;
    readonly refreshProviders: RpcUnaryNoArgMethod<typeof WS_METHODS.serverRefreshProviders>;
    readonly upsertKeybinding: RpcUnaryMethod<typeof WS_METHODS.serverUpsertKeybinding>;
    readonly getSettings: RpcUnaryNoArgMethod<typeof WS_METHODS.serverGetSettings>;
    readonly updateSettings: (
      patch: ServerSettingsPatch,
    ) => ReturnType<RpcUnaryMethod<typeof WS_METHODS.serverUpdateSettings>>;
    readonly subscribeConfig: RpcStreamMethod<typeof WS_METHODS.subscribeServerConfig>;
    readonly subscribeLifecycle: RpcStreamMethod<typeof WS_METHODS.subscribeServerLifecycle>;
    readonly subscribeAuthAccess: RpcStreamMethod<typeof WS_METHODS.subscribeAuthAccess>;
  };
  readonly usage: {
    readonly getDashboard: (
      range?: UsageRange,
    ) => Promise<Awaited<ReturnType<RpcUnaryMethod<typeof WS_METHODS.usageGetDashboard>>>>;
    readonly refreshDashboard: (
      range?: UsageRange,
    ) => Promise<Awaited<ReturnType<RpcUnaryMethod<typeof WS_METHODS.usageRefreshDashboard>>>>;
    readonly subscribe: RpcStreamMethod<typeof WS_METHODS.subscribeUsage>;
  };
  readonly orchestration: {
    readonly getSnapshot: RpcUnaryNoArgMethod<typeof ORCHESTRATION_WS_METHODS.getSnapshot>;
    readonly dispatchCommand: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.dispatchCommand>;
    readonly getTurnDiff: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.getTurnDiff>;
    readonly getFullThreadDiff: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.getFullThreadDiff>;
    readonly replayEvents: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.replayEvents>;
    readonly onDomainEvent: RpcStreamMethod<typeof WS_METHODS.subscribeOrchestrationDomainEvents>;
  };
}

export function createWsRpcClient(transport: WsTransport): WsRpcClient {
  return {
    dispose: () => transport.dispose(),
    reconnect: async () => {
      resetWsReconnectBackoff();
      await transport.reconnect();
    },
    terminal: {
      open: (input) => transport.request((client) => client[WS_METHODS.terminalOpen](input)),
      write: (input) => transport.request((client) => client[WS_METHODS.terminalWrite](input)),
      resize: (input) => transport.request((client) => client[WS_METHODS.terminalResize](input)),
      clear: (input) => transport.request((client) => client[WS_METHODS.terminalClear](input)),
      restart: (input) => transport.request((client) => client[WS_METHODS.terminalRestart](input)),
      close: (input) => transport.request((client) => client[WS_METHODS.terminalClose](input)),
      onEvent: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeTerminalEvents]({}),
          listener,
          options,
        ),
    },
    projects: {
      listDirectory: (input) =>
        transport.request((client) => client[WS_METHODS.projectsListDirectory](input)),
      readFile: (input) =>
        transport.request((client) => client[WS_METHODS.projectsReadFile](input)),
      searchEntries: (input) =>
        transport.request((client) => client[WS_METHODS.projectsSearchEntries](input)),
      writeFile: (input) =>
        transport.request((client) => client[WS_METHODS.projectsWriteFile](input)),
    },
    workspaces: {
      create: (input) => transport.request((client) => client[WS_METHODS.workspacesCreate](input)),
      update: (input) => transport.request((client) => client[WS_METHODS.workspacesUpdate](input)),
      setActive: (input) =>
        transport.request((client) => client[WS_METHODS.workspacesSetActive](input)),
      getDeletePreview: (input) =>
        transport.request((client) => client[WS_METHODS.workspacesGetDeletePreview](input)),
      delete: (input) => transport.request((client) => client[WS_METHODS.workspacesDelete](input)),
      listOpenCandidates: (input) =>
        transport.request((client) => client[WS_METHODS.workspacesListOpenCandidates](input)),
      openMainRepo: (input) =>
        transport.request((client) => client[WS_METHODS.workspacesOpenMainRepo](input)),
      openTrackedWorktree: (input) =>
        transport.request((client) => client[WS_METHODS.workspacesOpenTrackedWorktree](input)),
      openExternalWorktree: (input) =>
        transport.request((client) => client[WS_METHODS.workspacesOpenExternalWorktree](input)),
      importAll: (input) =>
        transport.request((client) => client[WS_METHODS.workspacesImportAll](input)),
      createSection: (input) =>
        transport.request((client) => client[WS_METHODS.workspacesCreateSection](input)),
      renameSection: (input) =>
        transport.request((client) => client[WS_METHODS.workspacesRenameSection](input)),
      deleteSection: (input) =>
        transport.request((client) => client[WS_METHODS.workspacesDeleteSection](input)),
      setSectionColor: (input) =>
        transport.request((client) => client[WS_METHODS.workspacesSetSectionColor](input)),
      toggleSectionCollapsed: (input) =>
        transport.request((client) => client[WS_METHODS.workspacesToggleSectionCollapsed](input)),
      reorderProjectChildren: (input) =>
        transport.request((client) => client[WS_METHODS.workspacesReorderProjectChildren](input)),
      reorderSectionWorkspaces: (input) =>
        transport.request((client) => client[WS_METHODS.workspacesReorderSectionWorkspaces](input)),
      moveToSection: (input) =>
        transport.request((client) => client[WS_METHODS.workspacesMoveToSection](input)),
    },
    shell: {
      openInEditor: (input) =>
        transport.request((client) => client[WS_METHODS.shellOpenInEditor](input)),
    },
    git: {
      pull: (input) => transport.request((client) => client[WS_METHODS.gitPull](input)),
      refreshStatus: (input) =>
        transport.request((client) => client[WS_METHODS.gitRefreshStatus](input)),
      onStatus: (input, listener, options) => {
        let current: GitStatusResult | null = null;
        return transport.subscribe(
          (client) => client[WS_METHODS.subscribeGitStatus](input),
          (event: GitStatusStreamEvent) => {
            current = applyGitStatusStreamEvent(current, event);
            listener(current);
          },
          options,
        );
      },
      runStackedAction: async (input, options) => {
        let result: GitRunStackedActionResult | null = null;

        await transport.requestStream(
          (client) => client[WS_METHODS.gitRunStackedAction](input),
          (event) => {
            options?.onProgress?.(event);
            if (event.kind === "action_finished") {
              result = event.result;
            }
          },
        );

        if (result) {
          return result;
        }

        throw new Error("Git action stream completed without a final result.");
      },
      listRepositories: (input) =>
        transport.request((client) => client[WS_METHODS.gitListRepositories](input)),
      listBranches: (input) =>
        transport.request((client) => client[WS_METHODS.gitListBranches](input)),
      getReviewStatus: (input) =>
        transport.request((client) => client[WS_METHODS.gitGetReviewStatus](input)),
      listCommits: (input) =>
        transport.request((client) => client[WS_METHODS.gitListCommits](input)),
      getCommitFiles: (input) =>
        transport.request((client) => client[WS_METHODS.gitGetCommitFiles](input)),
      getFileDiff: (input) =>
        transport.request((client) => client[WS_METHODS.gitGetFileDiff](input)),
      createWorktree: (input) =>
        transport.request((client) => client[WS_METHODS.gitCreateWorktree](input)),
      removeWorktree: (input) =>
        transport.request((client) => client[WS_METHODS.gitRemoveWorktree](input)),
      createBranch: (input) =>
        transport.request((client) => client[WS_METHODS.gitCreateBranch](input)),
      checkout: (input) => transport.request((client) => client[WS_METHODS.gitCheckout](input)),
      init: (input) => transport.request((client) => client[WS_METHODS.gitInit](input)),
      resolvePullRequest: (input) =>
        transport.request((client) => client[WS_METHODS.gitResolvePullRequest](input)),
      preparePullRequestThread: (input) =>
        transport.request((client) => client[WS_METHODS.gitPreparePullRequestThread](input)),
    },
    server: {
      getConfig: () => transport.request((client) => client[WS_METHODS.serverGetConfig]({})),
      refreshProviders: () =>
        transport.request((client) => client[WS_METHODS.serverRefreshProviders]({})),
      upsertKeybinding: (input) =>
        transport.request((client) => client[WS_METHODS.serverUpsertKeybinding](input)),
      getSettings: () => transport.request((client) => client[WS_METHODS.serverGetSettings]({})),
      updateSettings: (patch) =>
        transport.request((client) => client[WS_METHODS.serverUpdateSettings]({ patch })),
      subscribeConfig: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeServerConfig]({}),
          listener,
          options,
        ),
      subscribeLifecycle: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeServerLifecycle]({}),
          listener,
          options,
        ),
      subscribeAuthAccess: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeAuthAccess]({}),
          listener,
          options,
        ),
    },
    usage: {
      getDashboard: (range) =>
        transport.request((client) =>
          client[WS_METHODS.usageGetDashboard]({ range: range ?? DEFAULT_USAGE_RANGE }),
        ),
      refreshDashboard: (range) =>
        transport.request((client) =>
          client[WS_METHODS.usageRefreshDashboard]({ range: range ?? DEFAULT_USAGE_RANGE }),
        ),
      subscribe: (listener, options) =>
        transport.subscribe((client) => client[WS_METHODS.subscribeUsage]({}), listener, options),
    },
    orchestration: {
      getSnapshot: () =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.getSnapshot]({})),
      dispatchCommand: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.dispatchCommand](input)),
      getTurnDiff: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.getTurnDiff](input)),
      getFullThreadDiff: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.getFullThreadDiff](input)),
      replayEvents: (input) =>
        transport
          .request((client) => client[ORCHESTRATION_WS_METHODS.replayEvents](input))
          .then((events) => [...events]),
      onDomainEvent: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeOrchestrationDomainEvents]({}),
          listener,
          options,
        ),
    },
  };
}
