import { Schema } from "effect";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { OpenError, OpenInEditorInput } from "./editor";
import { AuthAccessStreamEvent } from "./auth";
import {
  GitActionProgressEvent,
  GitCheckoutInput,
  GitCheckoutResult,
  GitGetCommitFilesInput,
  GitGetCommitFilesResult,
  GitGetFileDiffInput,
  GitGetFileDiffResult,
  GitCommandError,
  GitCreateBranchInput,
  GitCreateBranchResult,
  GitCreateWorktreeInput,
  GitCreateWorktreeResult,
  GitInitInput,
  GitListBranchesInput,
  GitListBranchesResult,
  GitListRepositoriesInput,
  GitListRepositoriesResult,
  GitListCommitsInput,
  GitListCommitsResult,
  GitReviewStatusInput,
  GitReviewStatusResult,
  GitManagerServiceError,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  GitPullInput,
  GitPullRequestRefInput,
  GitPullResult,
  GitRemoveWorktreeInput,
  GitResolvePullRequestResult,
  GitRunStackedActionInput,
  GitStatusInput,
  GitStatusResult,
  GitStatusStreamEvent,
} from "./git";
import { KeybindingsConfigError } from "./keybindings";
import {
  ClientOrchestrationCommand,
  OrchestrationEvent,
  ORCHESTRATION_WS_METHODS,
  OrchestrationDispatchCommandError,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetSnapshotError,
  OrchestrationGetSnapshotInput,
  OrchestrationGetTurnDiffError,
  OrchestrationGetTurnDiffInput,
  OrchestrationReplayEventsError,
  OrchestrationReplayEventsInput,
  OrchestrationRpcSchemas,
} from "./orchestration";
import {
  ProjectListDirectoryError,
  ProjectListDirectoryInput,
  ProjectListDirectoryResult,
  ProjectReadFileError,
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectSearchEntriesError,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectWriteFileError,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project";
import {
  Workspace,
  WorkspaceCreateInput,
  WorkspaceDeleteInput,
  WorkspaceDeletePreview,
  WorkspaceError,
  WorkspaceImportAllInput,
  WorkspaceMoveToSectionInput,
  WorkspaceOpenCandidates,
  WorkspaceOpenExternalWorktreeInput,
  WorkspaceOpenMainRepoInput,
  WorkspaceOpenTrackedWorktreeInput,
  WorkspaceReorderProjectChildrenInput,
  WorkspaceReorderSectionWorkspacesInput,
  WorkspaceSection,
  WorkspaceSectionColorInput,
  WorkspaceSectionCreateInput,
  WorkspaceSectionDeleteInput,
  WorkspaceSectionRenameInput,
  WorkspaceSectionToggleCollapsedInput,
  WorkspaceSetActiveInput,
  WorkspaceUpdateInput,
} from "./workspace";
import {
  TerminalClearInput,
  TerminalCloseInput,
  TerminalError,
  TerminalEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
} from "./terminal";
import {
  ServerConfigStreamEvent,
  ServerConfig,
  ServerLifecycleStreamEvent,
  ServerProviderUpdatedPayload,
  ServerUpsertKeybindingInput,
  ServerUpsertKeybindingResult,
} from "./server";
import { ServerSettings, ServerSettingsError, ServerSettingsPatch } from "./settings";
import {
  UsageDashboardError,
  UsageDashboardRequest,
  UsageDashboardSnapshot,
  UsageStreamEvent,
} from "./usage";

export const WS_METHODS = {
  // Project registry methods
  projectsList: "projects.list",
  projectsAdd: "projects.add",
  projectsRemove: "projects.remove",
  projectsListDirectory: "projects.listDirectory",
  projectsReadFile: "projects.readFile",
  projectsSearchEntries: "projects.searchEntries",
  projectsWriteFile: "projects.writeFile",

  // Workspace methods
  workspacesCreate: "workspaces.create",
  workspacesUpdate: "workspaces.update",
  workspacesSetActive: "workspaces.setActive",
  workspacesGetDeletePreview: "workspaces.getDeletePreview",
  workspacesDelete: "workspaces.delete",
  workspacesListOpenCandidates: "workspaces.listOpenCandidates",
  workspacesOpenMainRepo: "workspaces.openMainRepo",
  workspacesOpenTrackedWorktree: "workspaces.openTrackedWorktree",
  workspacesOpenExternalWorktree: "workspaces.openExternalWorktree",
  workspacesImportAll: "workspaces.importAll",
  workspacesCreateSection: "workspaces.createSection",
  workspacesRenameSection: "workspaces.renameSection",
  workspacesDeleteSection: "workspaces.deleteSection",
  workspacesSetSectionColor: "workspaces.setSectionColor",
  workspacesToggleSectionCollapsed: "workspaces.toggleSectionCollapsed",
  workspacesReorderProjectChildren: "workspaces.reorderProjectChildren",
  workspacesReorderSectionWorkspaces: "workspaces.reorderSectionWorkspaces",
  workspacesMoveToSection: "workspaces.moveToSection",

  // Shell methods
  shellOpenInEditor: "shell.openInEditor",

  // Git methods
  gitPull: "git.pull",
  gitRefreshStatus: "git.refreshStatus",
  gitRunStackedAction: "git.runStackedAction",
  gitListRepositories: "git.listRepositories",
  gitListBranches: "git.listBranches",
  gitGetReviewStatus: "git.getReviewStatus",
  gitListCommits: "git.listCommits",
  gitGetCommitFiles: "git.getCommitFiles",
  gitGetFileDiff: "git.getFileDiff",
  gitCreateWorktree: "git.createWorktree",
  gitRemoveWorktree: "git.removeWorktree",
  gitCreateBranch: "git.createBranch",
  gitCheckout: "git.checkout",
  gitInit: "git.init",
  gitResolvePullRequest: "git.resolvePullRequest",
  gitPreparePullRequestThread: "git.preparePullRequestThread",

  // Terminal methods
  terminalOpen: "terminal.open",
  terminalWrite: "terminal.write",
  terminalResize: "terminal.resize",
  terminalClear: "terminal.clear",
  terminalRestart: "terminal.restart",
  terminalClose: "terminal.close",

  // Server meta
  serverGetConfig: "server.getConfig",
  serverRefreshProviders: "server.refreshProviders",
  serverUpsertKeybinding: "server.upsertKeybinding",
  serverGetSettings: "server.getSettings",
  serverUpdateSettings: "server.updateSettings",
  usageGetDashboard: "usage.getDashboard",
  usageRefreshDashboard: "usage.refreshDashboard",

  // Streaming subscriptions
  subscribeGitStatus: "subscribeGitStatus",
  subscribeOrchestrationDomainEvents: "subscribeOrchestrationDomainEvents",
  subscribeTerminalEvents: "subscribeTerminalEvents",
  subscribeServerConfig: "subscribeServerConfig",
  subscribeServerLifecycle: "subscribeServerLifecycle",
  subscribeAuthAccess: "subscribeAuthAccess",
  subscribeUsage: "subscribeUsage",
} as const;

export const WsServerUpsertKeybindingRpc = Rpc.make(WS_METHODS.serverUpsertKeybinding, {
  payload: ServerUpsertKeybindingInput,
  success: ServerUpsertKeybindingResult,
  error: KeybindingsConfigError,
});

export const WsServerGetConfigRpc = Rpc.make(WS_METHODS.serverGetConfig, {
  payload: Schema.Struct({}),
  success: ServerConfig,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError]),
});

export const WsServerRefreshProvidersRpc = Rpc.make(WS_METHODS.serverRefreshProviders, {
  payload: Schema.Struct({}),
  success: ServerProviderUpdatedPayload,
});

export const WsServerGetSettingsRpc = Rpc.make(WS_METHODS.serverGetSettings, {
  payload: Schema.Struct({}),
  success: ServerSettings,
  error: ServerSettingsError,
});

export const WsServerUpdateSettingsRpc = Rpc.make(WS_METHODS.serverUpdateSettings, {
  payload: Schema.Struct({ patch: ServerSettingsPatch }),
  success: ServerSettings,
  error: ServerSettingsError,
});

export const WsUsageGetDashboardRpc = Rpc.make(WS_METHODS.usageGetDashboard, {
  payload: UsageDashboardRequest,
  success: UsageDashboardSnapshot,
  error: UsageDashboardError,
});

export const WsUsageRefreshDashboardRpc = Rpc.make(WS_METHODS.usageRefreshDashboard, {
  payload: UsageDashboardRequest,
  success: UsageDashboardSnapshot,
  error: UsageDashboardError,
});

export const WsProjectsSearchEntriesRpc = Rpc.make(WS_METHODS.projectsSearchEntries, {
  payload: ProjectSearchEntriesInput,
  success: ProjectSearchEntriesResult,
  error: ProjectSearchEntriesError,
});

export const WsProjectsListDirectoryRpc = Rpc.make(WS_METHODS.projectsListDirectory, {
  payload: ProjectListDirectoryInput,
  success: ProjectListDirectoryResult,
  error: ProjectListDirectoryError,
});

export const WsProjectsReadFileRpc = Rpc.make(WS_METHODS.projectsReadFile, {
  payload: ProjectReadFileInput,
  success: ProjectReadFileResult,
  error: ProjectReadFileError,
});

export const WsProjectsWriteFileRpc = Rpc.make(WS_METHODS.projectsWriteFile, {
  payload: ProjectWriteFileInput,
  success: ProjectWriteFileResult,
  error: ProjectWriteFileError,
});

export const WsWorkspacesCreateRpc = Rpc.make(WS_METHODS.workspacesCreate, {
  payload: WorkspaceCreateInput,
  success: Workspace,
  error: WorkspaceError,
});

export const WsWorkspacesUpdateRpc = Rpc.make(WS_METHODS.workspacesUpdate, {
  payload: WorkspaceUpdateInput,
  success: Workspace,
  error: WorkspaceError,
});

export const WsWorkspacesSetActiveRpc = Rpc.make(WS_METHODS.workspacesSetActive, {
  payload: WorkspaceSetActiveInput,
  success: Workspace,
  error: WorkspaceError,
});

export const WsWorkspacesGetDeletePreviewRpc = Rpc.make(WS_METHODS.workspacesGetDeletePreview, {
  payload: WorkspaceDeleteInput,
  success: WorkspaceDeletePreview,
  error: WorkspaceError,
});

export const WsWorkspacesDeleteRpc = Rpc.make(WS_METHODS.workspacesDelete, {
  payload: WorkspaceDeleteInput,
  success: Schema.Struct({}),
  error: WorkspaceError,
});

export const WsWorkspacesListOpenCandidatesRpc = Rpc.make(WS_METHODS.workspacesListOpenCandidates, {
  payload: WorkspaceOpenMainRepoInput,
  success: WorkspaceOpenCandidates,
  error: WorkspaceError,
});

export const WsWorkspacesOpenMainRepoRpc = Rpc.make(WS_METHODS.workspacesOpenMainRepo, {
  payload: WorkspaceOpenMainRepoInput,
  success: Workspace,
  error: WorkspaceError,
});

export const WsWorkspacesOpenTrackedWorktreeRpc = Rpc.make(
  WS_METHODS.workspacesOpenTrackedWorktree,
  {
    payload: WorkspaceOpenTrackedWorktreeInput,
    success: Workspace,
    error: WorkspaceError,
  },
);

export const WsWorkspacesOpenExternalWorktreeRpc = Rpc.make(
  WS_METHODS.workspacesOpenExternalWorktree,
  {
    payload: WorkspaceOpenExternalWorktreeInput,
    success: Workspace,
    error: WorkspaceError,
  },
);

export const WsWorkspacesImportAllRpc = Rpc.make(WS_METHODS.workspacesImportAll, {
  payload: WorkspaceImportAllInput,
  success: Schema.Array(Workspace),
  error: WorkspaceError,
});

export const WsWorkspacesCreateSectionRpc = Rpc.make(WS_METHODS.workspacesCreateSection, {
  payload: WorkspaceSectionCreateInput,
  success: WorkspaceSection,
  error: WorkspaceError,
});

export const WsWorkspacesRenameSectionRpc = Rpc.make(WS_METHODS.workspacesRenameSection, {
  payload: WorkspaceSectionRenameInput,
  success: WorkspaceSection,
  error: WorkspaceError,
});

export const WsWorkspacesDeleteSectionRpc = Rpc.make(WS_METHODS.workspacesDeleteSection, {
  payload: WorkspaceSectionDeleteInput,
  success: Schema.Struct({}),
  error: WorkspaceError,
});

export const WsWorkspacesSetSectionColorRpc = Rpc.make(WS_METHODS.workspacesSetSectionColor, {
  payload: WorkspaceSectionColorInput,
  success: WorkspaceSection,
  error: WorkspaceError,
});

export const WsWorkspacesToggleSectionCollapsedRpc = Rpc.make(
  WS_METHODS.workspacesToggleSectionCollapsed,
  {
    payload: WorkspaceSectionToggleCollapsedInput,
    success: WorkspaceSection,
    error: WorkspaceError,
  },
);

export const WsWorkspacesReorderProjectChildrenRpc = Rpc.make(
  WS_METHODS.workspacesReorderProjectChildren,
  {
    payload: WorkspaceReorderProjectChildrenInput,
    success: Schema.Struct({}),
    error: WorkspaceError,
  },
);

export const WsWorkspacesReorderSectionWorkspacesRpc = Rpc.make(
  WS_METHODS.workspacesReorderSectionWorkspaces,
  {
    payload: WorkspaceReorderSectionWorkspacesInput,
    success: Schema.Struct({}),
    error: WorkspaceError,
  },
);

export const WsWorkspacesMoveToSectionRpc = Rpc.make(WS_METHODS.workspacesMoveToSection, {
  payload: WorkspaceMoveToSectionInput,
  success: Workspace,
  error: WorkspaceError,
});

export const WsShellOpenInEditorRpc = Rpc.make(WS_METHODS.shellOpenInEditor, {
  payload: OpenInEditorInput,
  error: OpenError,
});

export const WsSubscribeGitStatusRpc = Rpc.make(WS_METHODS.subscribeGitStatus, {
  payload: GitStatusInput,
  success: GitStatusStreamEvent,
  error: GitManagerServiceError,
  stream: true,
});

export const WsGitPullRpc = Rpc.make(WS_METHODS.gitPull, {
  payload: GitPullInput,
  success: GitPullResult,
  error: GitCommandError,
});

export const WsGitRefreshStatusRpc = Rpc.make(WS_METHODS.gitRefreshStatus, {
  payload: GitStatusInput,
  success: GitStatusResult,
  error: GitManagerServiceError,
});

export const WsGitRunStackedActionRpc = Rpc.make(WS_METHODS.gitRunStackedAction, {
  payload: GitRunStackedActionInput,
  success: GitActionProgressEvent,
  error: GitManagerServiceError,
  stream: true,
});

export const WsGitResolvePullRequestRpc = Rpc.make(WS_METHODS.gitResolvePullRequest, {
  payload: GitPullRequestRefInput,
  success: GitResolvePullRequestResult,
  error: GitManagerServiceError,
});

export const WsGitPreparePullRequestThreadRpc = Rpc.make(WS_METHODS.gitPreparePullRequestThread, {
  payload: GitPreparePullRequestThreadInput,
  success: GitPreparePullRequestThreadResult,
  error: GitManagerServiceError,
});

export const WsGitListRepositoriesRpc = Rpc.make(WS_METHODS.gitListRepositories, {
  payload: GitListRepositoriesInput,
  success: GitListRepositoriesResult,
  error: GitCommandError,
});

export const WsGitListBranchesRpc = Rpc.make(WS_METHODS.gitListBranches, {
  payload: GitListBranchesInput,
  success: GitListBranchesResult,
  error: GitCommandError,
});

export const WsGitGetReviewStatusRpc = Rpc.make(WS_METHODS.gitGetReviewStatus, {
  payload: GitReviewStatusInput,
  success: GitReviewStatusResult,
  error: GitCommandError,
});

export const WsGitListCommitsRpc = Rpc.make(WS_METHODS.gitListCommits, {
  payload: GitListCommitsInput,
  success: GitListCommitsResult,
  error: GitCommandError,
});

export const WsGitGetCommitFilesRpc = Rpc.make(WS_METHODS.gitGetCommitFiles, {
  payload: GitGetCommitFilesInput,
  success: GitGetCommitFilesResult,
  error: GitCommandError,
});

export const WsGitGetFileDiffRpc = Rpc.make(WS_METHODS.gitGetFileDiff, {
  payload: GitGetFileDiffInput,
  success: GitGetFileDiffResult,
  error: GitCommandError,
});

export const WsGitCreateWorktreeRpc = Rpc.make(WS_METHODS.gitCreateWorktree, {
  payload: GitCreateWorktreeInput,
  success: GitCreateWorktreeResult,
  error: GitCommandError,
});

export const WsGitRemoveWorktreeRpc = Rpc.make(WS_METHODS.gitRemoveWorktree, {
  payload: GitRemoveWorktreeInput,
  error: GitCommandError,
});

export const WsGitCreateBranchRpc = Rpc.make(WS_METHODS.gitCreateBranch, {
  payload: GitCreateBranchInput,
  success: GitCreateBranchResult,
  error: GitCommandError,
});

export const WsGitCheckoutRpc = Rpc.make(WS_METHODS.gitCheckout, {
  payload: GitCheckoutInput,
  success: GitCheckoutResult,
  error: GitCommandError,
});

export const WsGitInitRpc = Rpc.make(WS_METHODS.gitInit, {
  payload: GitInitInput,
  error: GitCommandError,
});

export const WsTerminalOpenRpc = Rpc.make(WS_METHODS.terminalOpen, {
  payload: TerminalOpenInput,
  success: TerminalSessionSnapshot,
  error: TerminalError,
});

export const WsTerminalWriteRpc = Rpc.make(WS_METHODS.terminalWrite, {
  payload: TerminalWriteInput,
  error: TerminalError,
});

export const WsTerminalResizeRpc = Rpc.make(WS_METHODS.terminalResize, {
  payload: TerminalResizeInput,
  error: TerminalError,
});

export const WsTerminalClearRpc = Rpc.make(WS_METHODS.terminalClear, {
  payload: TerminalClearInput,
  error: TerminalError,
});

export const WsTerminalRestartRpc = Rpc.make(WS_METHODS.terminalRestart, {
  payload: TerminalRestartInput,
  success: TerminalSessionSnapshot,
  error: TerminalError,
});

export const WsTerminalCloseRpc = Rpc.make(WS_METHODS.terminalClose, {
  payload: TerminalCloseInput,
  error: TerminalError,
});

export const WsOrchestrationGetSnapshotRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getSnapshot, {
  payload: OrchestrationGetSnapshotInput,
  success: OrchestrationRpcSchemas.getSnapshot.output,
  error: OrchestrationGetSnapshotError,
});

export const WsOrchestrationDispatchCommandRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.dispatchCommand,
  {
    payload: ClientOrchestrationCommand,
    success: OrchestrationRpcSchemas.dispatchCommand.output,
    error: OrchestrationDispatchCommandError,
  },
);

export const WsOrchestrationGetTurnDiffRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getTurnDiff, {
  payload: OrchestrationGetTurnDiffInput,
  success: OrchestrationRpcSchemas.getTurnDiff.output,
  error: OrchestrationGetTurnDiffError,
});

export const WsOrchestrationGetFullThreadDiffRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getFullThreadDiff,
  {
    payload: OrchestrationGetFullThreadDiffInput,
    success: OrchestrationRpcSchemas.getFullThreadDiff.output,
    error: OrchestrationGetFullThreadDiffError,
  },
);

export const WsOrchestrationReplayEventsRpc = Rpc.make(ORCHESTRATION_WS_METHODS.replayEvents, {
  payload: OrchestrationReplayEventsInput,
  success: OrchestrationRpcSchemas.replayEvents.output,
  error: OrchestrationReplayEventsError,
});

export const WsSubscribeOrchestrationDomainEventsRpc = Rpc.make(
  WS_METHODS.subscribeOrchestrationDomainEvents,
  {
    payload: Schema.Struct({}),
    success: OrchestrationEvent,
    stream: true,
  },
);

export const WsSubscribeTerminalEventsRpc = Rpc.make(WS_METHODS.subscribeTerminalEvents, {
  payload: Schema.Struct({}),
  success: TerminalEvent,
  stream: true,
});

export const WsSubscribeServerConfigRpc = Rpc.make(WS_METHODS.subscribeServerConfig, {
  payload: Schema.Struct({}),
  success: ServerConfigStreamEvent,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError]),
  stream: true,
});

export const WsSubscribeServerLifecycleRpc = Rpc.make(WS_METHODS.subscribeServerLifecycle, {
  payload: Schema.Struct({}),
  success: ServerLifecycleStreamEvent,
  stream: true,
});

export const WsSubscribeAuthAccessRpc = Rpc.make(WS_METHODS.subscribeAuthAccess, {
  payload: Schema.Struct({}),
  success: AuthAccessStreamEvent,
  stream: true,
});

export const WsSubscribeUsageRpc = Rpc.make(WS_METHODS.subscribeUsage, {
  payload: Schema.Struct({}),
  success: UsageStreamEvent,
  stream: true,
});

export const WsRpcGroup = RpcGroup.make(
  WsServerGetConfigRpc,
  WsServerRefreshProvidersRpc,
  WsServerUpsertKeybindingRpc,
  WsServerGetSettingsRpc,
  WsServerUpdateSettingsRpc,
  WsUsageGetDashboardRpc,
  WsUsageRefreshDashboardRpc,
  WsProjectsListDirectoryRpc,
  WsProjectsReadFileRpc,
  WsProjectsSearchEntriesRpc,
  WsProjectsWriteFileRpc,
  WsWorkspacesCreateRpc,
  WsWorkspacesUpdateRpc,
  WsWorkspacesSetActiveRpc,
  WsWorkspacesGetDeletePreviewRpc,
  WsWorkspacesDeleteRpc,
  WsWorkspacesListOpenCandidatesRpc,
  WsWorkspacesOpenMainRepoRpc,
  WsWorkspacesOpenTrackedWorktreeRpc,
  WsWorkspacesOpenExternalWorktreeRpc,
  WsWorkspacesImportAllRpc,
  WsWorkspacesCreateSectionRpc,
  WsWorkspacesRenameSectionRpc,
  WsWorkspacesDeleteSectionRpc,
  WsWorkspacesSetSectionColorRpc,
  WsWorkspacesToggleSectionCollapsedRpc,
  WsWorkspacesReorderProjectChildrenRpc,
  WsWorkspacesReorderSectionWorkspacesRpc,
  WsWorkspacesMoveToSectionRpc,
  WsShellOpenInEditorRpc,
  WsSubscribeGitStatusRpc,
  WsGitPullRpc,
  WsGitRefreshStatusRpc,
  WsGitRunStackedActionRpc,
  WsGitResolvePullRequestRpc,
  WsGitPreparePullRequestThreadRpc,
  WsGitListRepositoriesRpc,
  WsGitListBranchesRpc,
  WsGitGetReviewStatusRpc,
  WsGitListCommitsRpc,
  WsGitGetCommitFilesRpc,
  WsGitGetFileDiffRpc,
  WsGitCreateWorktreeRpc,
  WsGitRemoveWorktreeRpc,
  WsGitCreateBranchRpc,
  WsGitCheckoutRpc,
  WsGitInitRpc,
  WsTerminalOpenRpc,
  WsTerminalWriteRpc,
  WsTerminalResizeRpc,
  WsTerminalClearRpc,
  WsTerminalRestartRpc,
  WsTerminalCloseRpc,
  WsSubscribeOrchestrationDomainEventsRpc,
  WsSubscribeTerminalEventsRpc,
  WsSubscribeServerConfigRpc,
  WsSubscribeServerLifecycleRpc,
  WsSubscribeAuthAccessRpc,
  WsSubscribeUsageRpc,
  WsOrchestrationGetSnapshotRpc,
  WsOrchestrationDispatchCommandRpc,
  WsOrchestrationGetTurnDiffRpc,
  WsOrchestrationGetFullThreadDiffRpc,
  WsOrchestrationReplayEventsRpc,
);
