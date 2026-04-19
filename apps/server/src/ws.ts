import { existsSync } from "node:fs";
import { Cause, Effect, Layer, Queue, Ref, Schema, Stream } from "effect";
import {
  type AuthAccessStreamEvent,
  AuthSessionId,
  CommandId,
  DEFAULT_USAGE_RANGE,
  EventId,
  type OrchestrationCommand,
  type GitActionProgressEvent,
  type GitManagerServiceError,
  OrchestrationDispatchCommandError,
  type OrchestrationEvent,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetSnapshotError,
  OrchestrationGetTurnDiffError,
  ORCHESTRATION_WS_METHODS,
  ProjectCreateDirectoryError,
  ProjectDeleteEntryError,
  ProjectListDirectoryError,
  ProjectMoveEntryError,
  type ProjectMutationErrorCode,
  ProjectReadFileError,
  ProjectSearchEntriesError,
  ProjectWriteFileError,
  OrchestrationReplayEventsError,
  ThreadId,
  type TerminalEvent,
  WS_METHODS,
  WorkspaceError,
  type Workspace as WorkspaceRecord,
  type WorkspaceDeleteInput,
  type WorkspaceMoveToSectionInput,
  type WorkspaceOpenExternalWorktreeInput,
  type WorkspaceProjectInput,
  type WorkspaceOpenTrackedWorktreeInput,
  type WorkspaceImportAllInput,
  type WorkspaceReorderProjectChildrenInput,
  type WorkspaceReorderSectionWorkspacesInput,
  type WorkspaceSection as WorkspaceSectionRecord,
  type WorkspaceSectionColorInput,
  type WorkspaceSectionCreateInput,
  type WorkspaceSectionDeleteInput,
  type WorkspaceSectionRenameInput,
  type WorkspaceSectionToggleCollapsedInput,
  type WorkspaceSetActiveInput,
  type WorkspaceUpdateInput,
  WsRpcGroup,
} from "@capycode/contracts";
import { clamp } from "effect/Number";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { CheckpointDiffQuery } from "./checkpointing/Services/CheckpointDiffQuery";
import { ServerConfig } from "./config";
import { GitCore, type GitCoreShape } from "./git/Services/GitCore";
import { GitManager } from "./git/Services/GitManager";
import { GitRepositoryCatalog } from "./git/Services/GitRepositoryCatalog";
import { GitStatusBroadcaster } from "./git/Services/GitStatusBroadcaster";
import { Keybindings } from "./keybindings";
import { Open, resolveAvailableEditors } from "./open";
import { normalizeDispatchCommand } from "./orchestration/Normalizer";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery";
import {
  observeRpcEffect,
  observeRpcStream,
  observeRpcStreamEffect,
} from "./observability/RpcInstrumentation";
import { ProviderRegistry } from "./provider/Services/ProviderRegistry";
import { ServerLifecycleEvents } from "./serverLifecycleEvents";
import { ServerRuntimeStartup } from "./serverRuntimeStartup";
import { ServerSettingsService } from "./serverSettings";
import { TerminalManager } from "./terminal/Services/Manager";
import { WorkspaceEntries } from "./workspace/Services/WorkspaceEntries";
import { WorkspaceFileSystem } from "./workspace/Services/WorkspaceFileSystem";
import { WorkspacePathOutsideRootError } from "./workspace/Services/WorkspacePaths";
import { ProjectSetupScriptRunner } from "./project/Services/ProjectSetupScriptRunner";
import { RepositoryIdentityResolver } from "./project/Services/RepositoryIdentityResolver";
import { ServerEnvironment } from "./environment/Services/ServerEnvironment";
import { UsageService } from "./usage/Services/UsageService";
import { ServerAuth } from "./auth/Services/ServerAuth";
import { isRootWorkspaceType, moveRootWorkspaceToFront } from "./workspace/rootWorkspace.ts";
import {
  BootstrapCredentialService,
  type BootstrapCredentialChange,
} from "./auth/Services/BootstrapCredentialService";
import {
  SessionCredentialService,
  type SessionCredentialChange,
} from "./auth/Services/SessionCredentialService";
import { respondToAuthError } from "./auth/http";

type WorkspaceDbRow = {
  readonly id: string;
  readonly projectId: string;
  readonly worktreeId: string | null;
  readonly type: "root" | "worktree";
  readonly name: string;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly sectionId: string | null;
  readonly tabOrder: number;
  readonly isDefault: number;
  readonly isActive: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastOpenedAt: string;
  readonly deletingAt: string | null;
};

type ProjectWorkspaceRootRow = {
  readonly workspaceRoot: string;
};

function toProjectMutationCode(code: string): ProjectMutationErrorCode {
  return code as ProjectMutationErrorCode;
}

type WorktreeDbRow = {
  readonly id: string;
  readonly projectId: string;
  readonly path: string;
  readonly branch: string;
  readonly baseBranch: string | null;
  readonly createdByCapycode: number;
  readonly ownsBranch: number;
};

type WorkspaceSectionDbRow = {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly tabOrder: number;
  readonly isCollapsed: number;
  readonly color: string | null;
  readonly createdAt: string;
};

type WorkspaceDeletePreviewDbRow = {
  readonly activeThreadCount: number;
  readonly archivedThreadCount: number;
  readonly totalThreadCount: number;
};

type ProjectChildOrderItemDbRow = {
  readonly kind: "workspace" | "section";
  readonly id: string;
};

type ListedGitWorktree = {
  readonly path: string;
  readonly branch: string | null;
  readonly isBare: boolean;
  readonly isDetached: boolean;
};

function makeWorkspaceError(message: string, cause?: unknown): WorkspaceError {
  return new WorkspaceError({
    message,
    ...(cause !== undefined ? { cause: cause as never } : {}),
  });
}

function mapWorkspaceRow(row: WorkspaceDbRow): WorkspaceRecord {
  return {
    id: row.id as never,
    projectId: row.projectId as never,
    worktreeId: row.worktreeId as never,
    type: row.type,
    name: row.name,
    branch: row.branch,
    worktreePath: row.worktreePath,
    sectionId: row.sectionId as never,
    tabOrder: row.tabOrder,
    isDefault: row.isDefault === 1,
    isActive: row.isActive === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastOpenedAt: row.lastOpenedAt,
    deletingAt: row.deletingAt,
  };
}

function mapWorkspaceSectionRow(row: WorkspaceSectionDbRow): WorkspaceSectionRecord {
  return {
    id: row.id as never,
    projectId: row.projectId as never,
    name: row.name,
    tabOrder: row.tabOrder,
    isCollapsed: row.isCollapsed === 1,
    color: row.color,
    createdAt: row.createdAt,
  };
}

const loadProjectWorkspaceRoot = (
  sql: SqlClient.SqlClient,
  projectId: string,
): Effect.Effect<string, WorkspaceError> =>
  Effect.gen(function* () {
    const rows = yield* sql<ProjectWorkspaceRootRow>`
      SELECT workspace_root AS "workspaceRoot"
      FROM projection_projects
      WHERE project_id = ${projectId}
        AND deleted_at IS NULL
      LIMIT 1
    `.pipe(
      Effect.mapError((cause) =>
        makeWorkspaceError("Failed to resolve project workspace root", cause),
      ),
    );

    const projectRoot = rows[0]?.workspaceRoot;
    if (!projectRoot) {
      return yield* makeWorkspaceError("Project not found for workspace operation");
    }

    return projectRoot;
  });

const loadWorkspaceRecord = (
  sql: SqlClient.SqlClient,
  workspaceId: string,
): Effect.Effect<WorkspaceRecord, WorkspaceError> =>
  Effect.gen(function* () {
    const rows = yield* sql<WorkspaceDbRow>`
      SELECT
        workspaces.id AS "id",
        workspaces.project_id AS "projectId",
        workspaces.worktree_id AS "worktreeId",
        workspaces.type AS "type",
        workspaces.name AS "name",
        workspaces.branch AS "branch",
        worktrees.path AS "worktreePath",
        workspaces.section_id AS "sectionId",
        workspaces.tab_order AS "tabOrder",
        workspaces.is_default AS "isDefault",
        CASE
          WHEN workspace_project_state.active_workspace_id = workspaces.id THEN 1
          ELSE 0
        END AS "isActive",
        workspaces.created_at AS "createdAt",
        workspaces.updated_at AS "updatedAt",
        workspaces.last_opened_at AS "lastOpenedAt",
        workspaces.deleting_at AS "deletingAt"
      FROM workspaces
      LEFT JOIN worktrees
        ON worktrees.id = workspaces.worktree_id
      LEFT JOIN workspace_project_state
        ON workspace_project_state.project_id = workspaces.project_id
      WHERE workspaces.id = ${workspaceId}
      LIMIT 1
    `.pipe(Effect.mapError((cause) => makeWorkspaceError("Failed to load workspace", cause)));

    const workspace = rows[0];
    if (!workspace) {
      return yield* makeWorkspaceError("Workspace not found");
    }

    return mapWorkspaceRow(workspace);
  });

const loadWorkspaceSectionRecord = (
  sql: SqlClient.SqlClient,
  sectionId: string,
): Effect.Effect<WorkspaceSectionRecord, WorkspaceError> =>
  Effect.gen(function* () {
    const rows = yield* sql<WorkspaceSectionDbRow>`
      SELECT
        id,
        project_id AS "projectId",
        name,
        tab_order AS "tabOrder",
        is_collapsed AS "isCollapsed",
        color,
        created_at AS "createdAt"
      FROM workspace_sections
      WHERE id = ${sectionId}
      LIMIT 1
    `.pipe(
      Effect.mapError((cause) => makeWorkspaceError("Failed to load workspace section", cause)),
    );

    const section = rows[0];
    if (!section) {
      return yield* makeWorkspaceError("Workspace section not found");
    }

    return mapWorkspaceSectionRow(section);
  });

const resolveCurrentBranchAtPath = (
  git: GitCoreShape,
  cwd: string,
): Effect.Effect<string, WorkspaceError> =>
  git.listBranches({ cwd }).pipe(
    Effect.map((result) => result.branches.find((branch) => branch.current)?.name ?? "main"),
    Effect.mapError((cause) => makeWorkspaceError("Failed to resolve current branch", cause)),
  );

function parseGitWorktreeListPorcelain(output: string): ReadonlyArray<ListedGitWorktree> {
  const blocks = output
    .trim()
    .split(/\n\s*\n/g)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  const worktrees: ListedGitWorktree[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    let path: string | null = null;
    let branch: string | null = null;
    let isBare = false;
    let isDetached = false;

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        path = line.slice("worktree ".length).trim();
        continue;
      }
      if (line.startsWith("branch ")) {
        const ref = line.slice("branch ".length).trim();
        branch = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
        continue;
      }
      if (line === "bare") {
        isBare = true;
        continue;
      }
      if (line === "detached") {
        isDetached = true;
      }
    }

    if (!path) {
      continue;
    }

    worktrees.push({
      path,
      branch,
      isBare,
      isDetached,
    });
  }

  return worktrees;
}

function toAuthAccessStreamEvent(
  change: BootstrapCredentialChange | SessionCredentialChange,
  revision: number,
  currentSessionId: AuthSessionId,
): AuthAccessStreamEvent {
  switch (change.type) {
    case "pairingLinkUpserted":
      return {
        version: 1,
        revision,
        type: "pairingLinkUpserted",
        payload: change.pairingLink,
      };
    case "pairingLinkRemoved":
      return {
        version: 1,
        revision,
        type: "pairingLinkRemoved",
        payload: { id: change.id },
      };
    case "clientUpserted":
      return {
        version: 1,
        revision,
        type: "clientUpserted",
        payload: {
          ...change.clientSession,
          current: change.clientSession.sessionId === currentSessionId,
        },
      };
    case "clientRemoved":
      return {
        version: 1,
        revision,
        type: "clientRemoved",
        payload: { sessionId: change.sessionId },
      };
  }
}

const makeWsRpcLayer = (currentSessionId: AuthSessionId) =>
  WsRpcGroup.toLayer(
    Effect.gen(function* () {
      const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
      const orchestrationEngine = yield* OrchestrationEngineService;
      const checkpointDiffQuery = yield* CheckpointDiffQuery;
      const keybindings = yield* Keybindings;
      const open = yield* Open;
      const gitManager = yield* GitManager;
      const git = yield* GitCore;
      const gitRepositoryCatalog = yield* GitRepositoryCatalog;
      const gitStatusBroadcaster = yield* GitStatusBroadcaster;
      const terminalManager = yield* TerminalManager;
      const providerRegistry = yield* ProviderRegistry;
      const config = yield* ServerConfig;
      const sql = yield* SqlClient.SqlClient;
      const lifecycleEvents = yield* ServerLifecycleEvents;
      const serverSettings = yield* ServerSettingsService;
      const usageService = yield* UsageService;
      const startup = yield* ServerRuntimeStartup;
      const workspaceEntries = yield* WorkspaceEntries;
      const workspaceFileSystem = yield* WorkspaceFileSystem;
      const projectSetupScriptRunner = yield* ProjectSetupScriptRunner;
      const repositoryIdentityResolver = yield* RepositoryIdentityResolver;
      const serverEnvironment = yield* ServerEnvironment;
      const serverAuth = yield* ServerAuth;
      const bootstrapCredentials = yield* BootstrapCredentialService;
      const sessions = yield* SessionCredentialService;
      const serverCommandId = (tag: string) =>
        CommandId.make(`server:${tag}:${crypto.randomUUID()}`);

      const loadAuthAccessSnapshot = () =>
        Effect.all({
          pairingLinks: serverAuth.listPairingLinks().pipe(Effect.orDie),
          clientSessions: serverAuth.listClientSessions(currentSessionId).pipe(Effect.orDie),
        });

      const appendSetupScriptActivity = (input: {
        readonly threadId: ThreadId;
        readonly kind: "setup-script.requested" | "setup-script.started" | "setup-script.failed";
        readonly summary: string;
        readonly createdAt: string;
        readonly payload: Record<string, unknown>;
        readonly tone: "info" | "error";
      }) =>
        orchestrationEngine.dispatch({
          type: "thread.activity.append",
          commandId: serverCommandId("setup-script-activity"),
          threadId: input.threadId,
          activity: {
            id: EventId.make(crypto.randomUUID()),
            tone: input.tone,
            kind: input.kind,
            summary: input.summary,
            payload: input.payload,
            turnId: null,
            createdAt: input.createdAt,
          },
          createdAt: input.createdAt,
        });

      const toDispatchCommandError = (cause: unknown, fallbackMessage: string) =>
        Schema.is(OrchestrationDispatchCommandError)(cause)
          ? cause
          : new OrchestrationDispatchCommandError({
              message: cause instanceof Error ? cause.message : fallbackMessage,
              cause,
            });

      const toBootstrapDispatchCommandCauseError = (cause: Cause.Cause<unknown>) => {
        const error = Cause.squash(cause);
        return Schema.is(OrchestrationDispatchCommandError)(error)
          ? error
          : new OrchestrationDispatchCommandError({
              message:
                error instanceof Error ? error.message : "Failed to bootstrap thread turn start.",
              cause,
            });
      };

      const enrichProjectEvent = (
        event: OrchestrationEvent,
      ): Effect.Effect<OrchestrationEvent, never, never> => {
        switch (event.type) {
          case "project.created":
            return repositoryIdentityResolver.resolve(event.payload.workspaceRoot).pipe(
              Effect.map((repositoryIdentity) => ({
                ...event,
                payload: {
                  ...event.payload,
                  repositoryIdentity,
                },
              })),
            );
          case "project.meta-updated":
            return Effect.gen(function* () {
              const workspaceRoot =
                event.payload.workspaceRoot ??
                (yield* orchestrationEngine.getReadModel()).projects.find(
                  (project) => project.id === event.payload.projectId,
                )?.workspaceRoot ??
                null;
              if (workspaceRoot === null) {
                return event;
              }

              const repositoryIdentity = yield* repositoryIdentityResolver.resolve(workspaceRoot);
              return {
                ...event,
                payload: {
                  ...event.payload,
                  repositoryIdentity,
                },
              } satisfies OrchestrationEvent;
            });
          default:
            return Effect.succeed(event);
        }
      };

      const enrichOrchestrationEvents = (events: ReadonlyArray<OrchestrationEvent>) =>
        Effect.forEach(events, enrichProjectEvent, { concurrency: 4 });

      const dispatchBootstrapTurnStart = (
        command: Extract<OrchestrationCommand, { type: "thread.turn.start" }>,
      ): Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> =>
        Effect.gen(function* () {
          const bootstrap = command.bootstrap;
          const { bootstrap: _bootstrap, ...finalTurnStartCommand } = command;
          let createdThread = false;
          let targetProjectId = bootstrap?.createThread?.projectId;
          let targetProjectCwd = bootstrap?.prepareWorktree?.projectCwd;
          let targetWorktreePath = bootstrap?.createThread?.worktreePath ?? null;

          const cleanupCreatedThread = () =>
            createdThread
              ? orchestrationEngine
                  .dispatch({
                    type: "thread.delete",
                    commandId: serverCommandId("bootstrap-thread-delete"),
                    threadId: command.threadId,
                  })
                  .pipe(Effect.ignoreCause({ log: true }))
              : Effect.void;

          const recordSetupScriptLaunchFailure = (input: {
            readonly error: unknown;
            readonly requestedAt: string;
            readonly worktreePath: string;
          }) => {
            const detail =
              input.error instanceof Error ? input.error.message : "Unknown setup failure.";
            return appendSetupScriptActivity({
              threadId: command.threadId,
              kind: "setup-script.failed",
              summary: "Setup script failed to start",
              createdAt: input.requestedAt,
              payload: {
                detail,
                worktreePath: input.worktreePath,
              },
              tone: "error",
            }).pipe(
              Effect.ignoreCause({ log: false }),
              Effect.flatMap(() =>
                Effect.logWarning("bootstrap turn start failed to launch setup script", {
                  threadId: command.threadId,
                  worktreePath: input.worktreePath,
                  detail,
                }),
              ),
            );
          };

          const recordSetupScriptStarted = (input: {
            readonly requestedAt: string;
            readonly worktreePath: string;
            readonly scriptId: string;
            readonly scriptName: string;
            readonly terminalId: string;
          }) => {
            const payload = {
              scriptId: input.scriptId,
              scriptName: input.scriptName,
              terminalId: input.terminalId,
              worktreePath: input.worktreePath,
            };
            return Effect.all([
              appendSetupScriptActivity({
                threadId: command.threadId,
                kind: "setup-script.requested",
                summary: "Starting setup script",
                createdAt: input.requestedAt,
                payload,
                tone: "info",
              }),
              appendSetupScriptActivity({
                threadId: command.threadId,
                kind: "setup-script.started",
                summary: "Setup script started",
                createdAt: new Date().toISOString(),
                payload,
                tone: "info",
              }),
            ]).pipe(
              Effect.asVoid,
              Effect.catch((error) =>
                Effect.logWarning(
                  "bootstrap turn start launched setup script but failed to record setup activity",
                  {
                    threadId: command.threadId,
                    worktreePath: input.worktreePath,
                    scriptId: input.scriptId,
                    terminalId: input.terminalId,
                    detail: error.message,
                  },
                ),
              ),
            );
          };

          const runSetupProgram = () =>
            bootstrap?.runSetupScript && targetWorktreePath
              ? (() => {
                  const worktreePath = targetWorktreePath;
                  const requestedAt = new Date().toISOString();
                  return projectSetupScriptRunner
                    .runForThread({
                      threadId: command.threadId,
                      ...(targetProjectId ? { projectId: targetProjectId } : {}),
                      ...(targetProjectCwd ? { projectCwd: targetProjectCwd } : {}),
                      worktreePath,
                    })
                    .pipe(
                      Effect.matchEffect({
                        onFailure: (error) =>
                          recordSetupScriptLaunchFailure({
                            error,
                            requestedAt,
                            worktreePath,
                          }),
                        onSuccess: (setupResult) => {
                          if (setupResult.status !== "started") {
                            return Effect.void;
                          }
                          return recordSetupScriptStarted({
                            requestedAt,
                            worktreePath,
                            scriptId: setupResult.scriptId,
                            scriptName: setupResult.scriptName,
                            terminalId: setupResult.terminalId,
                          });
                        },
                      }),
                    );
                })()
              : Effect.void;

          const bootstrapProgram = Effect.gen(function* () {
            if (bootstrap?.createThread) {
              yield* orchestrationEngine.dispatch({
                type: "thread.create",
                commandId: serverCommandId("bootstrap-thread-create"),
                threadId: command.threadId,
                projectId: bootstrap.createThread.projectId,
                workspaceId: bootstrap.createThread.workspaceId,
                title: bootstrap.createThread.title,
                modelSelection: bootstrap.createThread.modelSelection,
                runtimeMode: bootstrap.createThread.runtimeMode,
                interactionMode: bootstrap.createThread.interactionMode,
                branch: bootstrap.createThread.branch,
                worktreePath: bootstrap.createThread.worktreePath,
                createdAt: bootstrap.createThread.createdAt,
              });
              createdThread = true;
            }

            if (bootstrap?.prepareWorktree) {
              const worktree = yield* git.createWorktree({
                cwd: bootstrap.prepareWorktree.projectCwd,
                branch: bootstrap.prepareWorktree.baseBranch,
                newBranch: bootstrap.prepareWorktree.branch,
                path: null,
              });
              targetWorktreePath = worktree.worktree.path;
              yield* orchestrationEngine.dispatch({
                type: "thread.meta.update",
                commandId: serverCommandId("bootstrap-thread-meta-update"),
                threadId: command.threadId,
                branch: worktree.worktree.branch,
                worktreePath: targetWorktreePath,
              });
            }

            yield* runSetupProgram();

            return yield* orchestrationEngine.dispatch(finalTurnStartCommand);
          });

          return yield* bootstrapProgram.pipe(
            Effect.catchCause((cause) => {
              const dispatchError = toBootstrapDispatchCommandCauseError(cause);
              if (Cause.hasInterruptsOnly(cause)) {
                return Effect.fail(dispatchError);
              }
              return cleanupCreatedThread().pipe(Effect.flatMap(() => Effect.fail(dispatchError)));
            }),
          );
        });

      const dispatchNormalizedCommand = (
        normalizedCommand: OrchestrationCommand,
      ): Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> => {
        const dispatchEffect =
          normalizedCommand.type === "thread.turn.start" && normalizedCommand.bootstrap
            ? dispatchBootstrapTurnStart(normalizedCommand)
            : orchestrationEngine
                .dispatch(normalizedCommand)
                .pipe(
                  Effect.mapError((cause) =>
                    toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
                  ),
                );

        return startup
          .enqueueCommand(dispatchEffect)
          .pipe(
            Effect.mapError((cause) =>
              toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
            ),
          );
      };

      const loadServerConfig = Effect.gen(function* () {
        const keybindingsConfig = yield* keybindings.loadConfigState;
        const providers = yield* providerRegistry.getProviders;
        const settings = yield* serverSettings.getSettings;
        const environment = yield* serverEnvironment.getDescriptor;
        const auth = yield* serverAuth.getDescriptor();

        return {
          environment,
          auth,
          cwd: config.cwd,
          keybindingsConfigPath: config.keybindingsConfigPath,
          keybindings: keybindingsConfig.keybindings,
          issues: keybindingsConfig.issues,
          providers,
          availableEditors: resolveAvailableEditors(),
          observability: {
            logsDirectoryPath: config.logsDir,
            localTracingEnabled: true,
            ...(config.otlpTracesUrl !== undefined ? { otlpTracesUrl: config.otlpTracesUrl } : {}),
            otlpTracesEnabled: config.otlpTracesUrl !== undefined,
            ...(config.otlpMetricsUrl !== undefined
              ? { otlpMetricsUrl: config.otlpMetricsUrl }
              : {}),
            otlpMetricsEnabled: config.otlpMetricsUrl !== undefined,
          },
          settings,
        };
      });

      const refreshGitStatus = (cwd: string) =>
        gitRepositoryCatalog
          .invalidateAll()
          .pipe(
            Effect.andThen(gitStatusBroadcaster.refreshStatus(cwd)),
            Effect.ignoreCause({ log: true }),
            Effect.forkDetach,
            Effect.asVoid,
          );

      const setActiveWorkspace = (workspaceId: string) =>
        Effect.gen(function* () {
          const workspace = yield* loadWorkspaceRecord(sql, workspaceId);
          const now = new Date().toISOString();
          yield* sql`
            INSERT INTO workspace_project_state (
              project_id,
              active_workspace_id,
              updated_at
            )
            VALUES (
              ${workspace.projectId},
              ${workspaceId},
              ${now}
            )
            ON CONFLICT (project_id)
            DO UPDATE SET
              active_workspace_id = excluded.active_workspace_id,
              updated_at = excluded.updated_at
          `.pipe(
            Effect.mapError((cause) => makeWorkspaceError("Failed to set active workspace", cause)),
          );
          yield* sql`
            UPDATE workspaces
            SET
              updated_at = ${now},
              last_opened_at = ${now}
            WHERE id = ${workspaceId}
          `.pipe(
            Effect.mapError((cause) =>
              makeWorkspaceError("Failed to update workspace status", cause),
            ),
          );
          return yield* loadWorkspaceRecord(sql, workspaceId);
        });

      const loadWorktreeRecordById = (worktreeId: string) =>
        Effect.gen(function* () {
          const rows = yield* sql<WorktreeDbRow>`
            SELECT
              id,
              project_id AS "projectId",
              path,
              branch,
              base_branch AS "baseBranch",
              created_by_capycode AS "createdByCapycode",
              owns_branch AS "ownsBranch"
            FROM worktrees
            WHERE id = ${worktreeId}
            LIMIT 1
          `.pipe(Effect.mapError((cause) => makeWorkspaceError("Failed to load worktree", cause)));
          const worktree = rows[0];
          if (!worktree) {
            return yield* makeWorkspaceError("Worktree not found");
          }
          return worktree;
        });

      const findWorktreeRecordByPath = (projectId: string, worktreePath: string) =>
        sql<WorktreeDbRow>`
          SELECT
            id,
            project_id AS "projectId",
            path,
            branch,
            base_branch AS "baseBranch",
            created_by_capycode AS "createdByCapycode",
            owns_branch AS "ownsBranch"
          FROM worktrees
          WHERE project_id = ${projectId}
            AND path = ${worktreePath}
          LIMIT 1
        `.pipe(
          Effect.map((rows) => rows[0] ?? null),
          Effect.mapError((cause) => makeWorkspaceError("Failed to load worktree", cause)),
        );

      const loadGitListedWorktrees = (projectRoot: string) =>
        git
          .execute({
            operation: "Workspace.listGitWorktrees",
            cwd: projectRoot,
            args: ["worktree", "list", "--porcelain"],
          })
          .pipe(
            Effect.map((result) => parseGitWorktreeListPorcelain(result.stdout)),
            Effect.mapError((cause) =>
              makeWorkspaceError("Failed to list git worktrees for project", cause),
            ),
          );

      const resolveNextTopLevelTabOrder = (projectId: string) =>
        sql<{ readonly nextTabOrder: number }>`
          SELECT COALESCE(MAX(tab_order) + 1, 0) AS "nextTabOrder"
          FROM (
            SELECT tab_order
            FROM workspaces
            WHERE project_id = ${projectId}
              AND section_id IS NULL
              AND deleting_at IS NULL
            UNION ALL
            SELECT tab_order
            FROM workspace_sections
            WHERE project_id = ${projectId}
          ) AS project_children
        `.pipe(
          Effect.map((rows) => rows[0]?.nextTabOrder ?? 0),
          Effect.mapError((cause) =>
            makeWorkspaceError("Failed to resolve top-level workspace ordering", cause),
          ),
        );

      const resolveNextSectionTabOrder = (sectionId: string) =>
        sql<{ readonly nextTabOrder: number }>`
          SELECT COALESCE(MAX(tab_order) + 1, 0) AS "nextTabOrder"
          FROM workspaces
          WHERE section_id = ${sectionId}
            AND deleting_at IS NULL
        `.pipe(
          Effect.map((rows) => rows[0]?.nextTabOrder ?? 0),
          Effect.mapError((cause) =>
            makeWorkspaceError("Failed to resolve section workspace ordering", cause),
          ),
        );

      const insertWorkspaceRecord = (input: {
        readonly projectId: string;
        readonly worktreeId: string | null;
        readonly type: "root" | "worktree";
        readonly branch: string;
        readonly name: string;
        readonly sectionId: string | null;
      }) =>
        Effect.gen(function* () {
          const now = new Date().toISOString();
          const tabOrder =
            input.sectionId === null
              ? yield* resolveNextTopLevelTabOrder(input.projectId)
              : yield* resolveNextSectionTabOrder(input.sectionId);
          const workspaceId = crypto.randomUUID();
          yield* sql`
            INSERT INTO workspaces (
              id,
              project_id,
              worktree_id,
              type,
              branch,
              name,
              tab_order,
              is_default,
              created_at,
              updated_at,
              last_opened_at,
              deleting_at,
              section_id
            )
            VALUES (
              ${workspaceId},
              ${input.projectId},
              ${input.worktreeId},
              ${input.type},
              ${input.branch},
              ${input.name},
              ${tabOrder},
              0,
              ${now},
              ${now},
              ${now},
              NULL,
              ${input.sectionId}
            )
          `.pipe(
            Effect.mapError((cause) => makeWorkspaceError("Failed to create workspace", cause)),
          );
          return yield* setActiveWorkspace(workspaceId);
        });

      const updateWorkspace = (input: { readonly workspaceId: string; readonly name: string }) =>
        Effect.gen(function* () {
          const workspace = yield* loadWorkspaceRecord(sql, input.workspaceId);
          const now = new Date().toISOString();
          yield* sql`
            UPDATE workspaces
            SET
              name = ${input.name},
              updated_at = ${now}
            WHERE id = ${workspace.id}
          `.pipe(
            Effect.mapError((cause) => makeWorkspaceError("Failed to update workspace", cause)),
          );
          return yield* loadWorkspaceRecord(sql, workspace.id);
        });

      const getWorkspaceDeletePreview = (workspaceId: string) =>
        Effect.gen(function* () {
          const workspace = yield* loadWorkspaceRecord(sql, workspaceId);
          const counts = yield* sql<WorkspaceDeletePreviewDbRow>`
            SELECT
              SUM(CASE WHEN archived_at IS NULL THEN 1 ELSE 0 END) AS "activeThreadCount",
              SUM(CASE WHEN archived_at IS NOT NULL THEN 1 ELSE 0 END) AS "archivedThreadCount",
              COUNT(*) AS "totalThreadCount"
            FROM projection_threads
            WHERE workspace_id = ${workspaceId}
              AND deleted_at IS NULL
          `.pipe(
            Effect.mapError((cause) =>
              makeWorkspaceError("Failed to inspect workspace thread usage", cause),
            ),
          );
          const worktree =
            workspace.worktreeId === null
              ? null
              : yield* loadWorktreeRecordById(workspace.worktreeId).pipe(
                  Effect.orElseSucceed(() => null),
                );
          const row = counts[0];
          const deletesWorktreePath =
            worktree !== null && worktree.createdByCapycode === 1 && existsSync(worktree.path);
          const deletesBranch = worktree !== null && worktree.ownsBranch === 1;
          return {
            workspaceId: workspace.id,
            activeThreadCount: row?.activeThreadCount ?? 0,
            archivedThreadCount: row?.archivedThreadCount ?? 0,
            totalThreadCount: row?.totalThreadCount ?? 0,
            deletesWorktreePath,
            worktreePath: workspace.worktreePath,
            deletesBranch,
            branchToDelete: deletesBranch ? (worktree?.branch ?? null) : null,
          };
        });

      const listOpenCandidates = (projectId: string) =>
        Effect.gen(function* () {
          const projectRoot = yield* loadProjectWorkspaceRoot(sql, projectId);
          const trackedWorktrees = yield* sql<WorktreeDbRow>`
            SELECT
              worktrees.id,
              worktrees.project_id AS "projectId",
              worktrees.path,
              worktrees.branch,
              worktrees.base_branch AS "baseBranch",
              worktrees.created_by_capycode AS "createdByCapycode",
              worktrees.owns_branch AS "ownsBranch"
            FROM worktrees
            LEFT JOIN workspaces
              ON workspaces.worktree_id = worktrees.id
              AND workspaces.deleting_at IS NULL
            WHERE worktrees.project_id = ${projectId}
              AND workspaces.id IS NULL
          `.pipe(
            Effect.mapError((cause) =>
              makeWorkspaceError("Failed to load tracked worktree candidates", cause),
            ),
          );
          const listed = yield* loadGitListedWorktrees(projectRoot);
          const trackedPaths = new Set(trackedWorktrees.map((worktree) => worktree.path));

          return {
            projectId: projectId as never,
            trackedWorktrees: trackedWorktrees
              .filter((worktree) => existsSync(worktree.path))
              .map((worktree) => ({
                worktreeId: worktree.id as never,
                projectId: worktree.projectId as never,
                path: worktree.path,
                branch: worktree.branch,
                baseBranch: worktree.baseBranch,
              })),
            externalWorktrees: listed
              .filter(
                (worktree) =>
                  worktree.path !== projectRoot &&
                  !worktree.isBare &&
                  !worktree.isDetached &&
                  worktree.branch !== null &&
                  !trackedPaths.has(worktree.path),
              )
              .map((worktree) => ({
                projectId: projectId as never,
                path: worktree.path,
                branch: worktree.branch ?? "main",
              })),
          };
        });

      const openTrackedWorktree = (worktreeId: string) =>
        Effect.gen(function* () {
          const worktree = yield* loadWorktreeRecordById(worktreeId);
          const existingWorkspaceRows = yield* sql<{ readonly id: string }>`
            SELECT id
            FROM workspaces
            WHERE worktree_id = ${worktreeId}
              AND deleting_at IS NULL
            LIMIT 1
          `.pipe(
            Effect.mapError((cause) =>
              makeWorkspaceError("Failed to inspect existing worktree workspace", cause),
            ),
          );
          if (existingWorkspaceRows[0]?.id) {
            return yield* setActiveWorkspace(existingWorkspaceRows[0].id);
          }
          if (!existsSync(worktree.path)) {
            return yield* makeWorkspaceError("Worktree no longer exists on disk");
          }
          return yield* insertWorkspaceRecord({
            projectId: worktree.projectId,
            worktreeId: worktree.id,
            type: "worktree",
            branch: worktree.branch,
            name: worktree.branch,
            sectionId: null,
          });
        });

      const openExternalWorktree = (input: {
        readonly projectId: string;
        readonly worktreePath: string;
        readonly branch: string;
      }) =>
        Effect.gen(function* () {
          const projectRoot = yield* loadProjectWorkspaceRoot(sql, input.projectId);
          const listed = yield* loadGitListedWorktrees(projectRoot);
          const matched = listed.find((worktree) => worktree.path === input.worktreePath);
          if (!matched || matched.isBare || matched.isDetached || matched.path === projectRoot) {
            return yield* makeWorkspaceError("External worktree not found");
          }

          const existingWorktree = yield* findWorktreeRecordByPath(
            input.projectId,
            input.worktreePath,
          );
          if (existingWorktree) {
            return yield* openTrackedWorktree(existingWorktree.id);
          }

          const now = new Date().toISOString();
          const worktreeId = crypto.randomUUID();
          const branch =
            matched.branch ??
            (yield* resolveCurrentBranchAtPath(git, input.worktreePath).pipe(
              Effect.orElseSucceed(() => input.branch),
            ));
          yield* sql`
            INSERT INTO worktrees (
              id,
              project_id,
              path,
              branch,
              base_branch,
              created_at,
              created_by_capycode,
              owns_branch
            )
            VALUES (
              ${worktreeId},
              ${input.projectId},
              ${input.worktreePath},
              ${branch},
              NULL,
              ${now},
              0,
              0
            )
          `.pipe(
            Effect.mapError((cause) =>
              makeWorkspaceError("Failed to import external worktree", cause),
            ),
          );

          return yield* insertWorkspaceRecord({
            projectId: input.projectId,
            worktreeId,
            type: "worktree",
            branch,
            name: branch,
            sectionId: null,
          });
        });

      const importAllWorkspaces = (projectId: string) =>
        Effect.gen(function* () {
          const candidates = yield* listOpenCandidates(projectId);
          const reopenedTracked = yield* Effect.forEach(
            candidates.trackedWorktrees,
            (candidate) => openTrackedWorktree(candidate.worktreeId),
            { concurrency: 1 },
          );
          const importedExternal = yield* Effect.forEach(
            candidates.externalWorktrees,
            (candidate) =>
              openExternalWorktree({
                projectId: candidate.projectId,
                worktreePath: candidate.path,
                branch: candidate.branch,
              }),
            { concurrency: 1 },
          );
          return [...reopenedTracked, ...importedExternal];
        });

      const createWorkspaceSection = (input: {
        readonly projectId: string;
        readonly name: string;
      }) =>
        Effect.gen(function* () {
          const tabOrder = yield* resolveNextTopLevelTabOrder(input.projectId);
          const sectionId = crypto.randomUUID();
          const createdAt = new Date().toISOString();
          yield* sql`
            INSERT INTO workspace_sections (
              id,
              project_id,
              name,
              tab_order,
              is_collapsed,
              color,
              created_at
            )
            VALUES (
              ${sectionId},
              ${input.projectId},
              ${input.name},
              ${tabOrder},
              0,
              NULL,
              ${createdAt}
            )
          `.pipe(
            Effect.mapError((cause) =>
              makeWorkspaceError("Failed to create workspace section", cause),
            ),
          );
          return yield* loadWorkspaceSectionRecord(sql, sectionId);
        });

      const renameWorkspaceSection = (input: {
        readonly sectionId: string;
        readonly name: string;
      }) =>
        Effect.gen(function* () {
          yield* loadWorkspaceSectionRecord(sql, input.sectionId);
          yield* sql`
            UPDATE workspace_sections
            SET name = ${input.name}
            WHERE id = ${input.sectionId}
          `.pipe(
            Effect.mapError((cause) =>
              makeWorkspaceError("Failed to rename workspace section", cause),
            ),
          );
          return yield* loadWorkspaceSectionRecord(sql, input.sectionId);
        });

      const deleteWorkspaceSection = (sectionId: string) =>
        Effect.gen(function* () {
          yield* loadWorkspaceSectionRecord(sql, sectionId);
          yield* sql`
            UPDATE workspaces
            SET section_id = NULL
            WHERE section_id = ${sectionId}
          `.pipe(
            Effect.mapError((cause) =>
              makeWorkspaceError("Failed to detach workspaces from section", cause),
            ),
          );
          yield* sql`
            DELETE FROM workspace_sections
            WHERE id = ${sectionId}
          `.pipe(
            Effect.mapError((cause) =>
              makeWorkspaceError("Failed to delete workspace section", cause),
            ),
          );
        });

      const setWorkspaceSectionColor = (input: {
        readonly sectionId: string;
        readonly color: string | null;
      }) =>
        Effect.gen(function* () {
          yield* loadWorkspaceSectionRecord(sql, input.sectionId);
          yield* sql`
            UPDATE workspace_sections
            SET color = ${input.color}
            WHERE id = ${input.sectionId}
          `.pipe(
            Effect.mapError((cause) =>
              makeWorkspaceError("Failed to update workspace section color", cause),
            ),
          );
          return yield* loadWorkspaceSectionRecord(sql, input.sectionId);
        });

      const toggleWorkspaceSectionCollapsed = (input: {
        readonly sectionId: string;
        readonly isCollapsed: boolean;
      }) =>
        Effect.gen(function* () {
          yield* loadWorkspaceSectionRecord(sql, input.sectionId);
          yield* sql`
            UPDATE workspace_sections
            SET is_collapsed = ${input.isCollapsed ? 1 : 0}
            WHERE id = ${input.sectionId}
          `.pipe(
            Effect.mapError((cause) =>
              makeWorkspaceError("Failed to update workspace section visibility", cause),
            ),
          );
          return yield* loadWorkspaceSectionRecord(sql, input.sectionId);
        });

      const reorderProjectChildren = (input: {
        readonly projectId: string;
        readonly orderedItems: ReadonlyArray<{
          readonly kind: "workspace" | "section";
          readonly id: string;
        }>;
      }) =>
        Effect.gen(function* () {
          const rootWorkspaceRow = yield* sql<{ readonly id: string }>`
            SELECT id
            FROM workspaces
            WHERE project_id = ${input.projectId}
              AND type = 'root'
              AND deleting_at IS NULL
            LIMIT 1
          `.pipe(
            Effect.mapError((cause) =>
              makeWorkspaceError("Failed to load root workspace ordering", cause),
            ),
          );
          const orderedItems = moveRootWorkspaceToFront(
            input.orderedItems,
            rootWorkspaceRow[0]?.id ?? null,
          );
          const currentItems = yield* sql<ProjectChildOrderItemDbRow>`
            SELECT id, 'workspace' AS "kind"
            FROM workspaces
            WHERE project_id = ${input.projectId}
              AND section_id IS NULL
              AND deleting_at IS NULL
            UNION ALL
            SELECT id, 'section' AS "kind"
            FROM workspace_sections
            WHERE project_id = ${input.projectId}
          `.pipe(
            Effect.mapError((cause) =>
              makeWorkspaceError("Failed to load project child ordering", cause),
            ),
          );
          const currentKeys = new Set(currentItems.map((item) => `${item.kind}:${item.id}`));
          const requestedKeys = new Set(orderedItems.map((item) => `${item.kind}:${item.id}`));
          if (
            currentKeys.size !== requestedKeys.size ||
            [...currentKeys].some((key) => !requestedKeys.has(key))
          ) {
            return yield* makeWorkspaceError("Project child order payload is invalid");
          }

          for (const [index, item] of orderedItems.entries()) {
            if (item.kind === "workspace") {
              yield* sql`
                UPDATE workspaces
                SET tab_order = ${index}
                WHERE id = ${item.id}
              `.pipe(
                Effect.mapError((cause) =>
                  makeWorkspaceError("Failed to update workspace ordering", cause),
                ),
              );
            } else {
              yield* sql`
                UPDATE workspace_sections
                SET tab_order = ${index}
                WHERE id = ${item.id}
              `.pipe(
                Effect.mapError((cause) =>
                  makeWorkspaceError("Failed to update section ordering", cause),
                ),
              );
            }
          }
        });

      const reorderSectionWorkspaces = (input: {
        readonly sectionId: string;
        readonly orderedWorkspaceIds: ReadonlyArray<string>;
      }) =>
        Effect.gen(function* () {
          yield* loadWorkspaceSectionRecord(sql, input.sectionId);
          const currentIds = yield* sql<{ readonly id: string }>`
            SELECT id
            FROM workspaces
            WHERE section_id = ${input.sectionId}
              AND deleting_at IS NULL
          `.pipe(
            Effect.mapError((cause) =>
              makeWorkspaceError("Failed to load section workspace ordering", cause),
            ),
          );
          const currentIdSet = new Set(currentIds.map((row) => row.id));
          const requestedIdSet = new Set(input.orderedWorkspaceIds);
          if (
            currentIdSet.size !== requestedIdSet.size ||
            [...currentIdSet].some((id) => !requestedIdSet.has(id))
          ) {
            return yield* makeWorkspaceError("Section workspace order payload is invalid");
          }

          for (const [index, workspaceId] of input.orderedWorkspaceIds.entries()) {
            yield* sql`
              UPDATE workspaces
              SET tab_order = ${index}
              WHERE id = ${workspaceId}
            `.pipe(
              Effect.mapError((cause) =>
                makeWorkspaceError("Failed to update section workspace ordering", cause),
              ),
            );
          }
        });

      const moveWorkspaceToSection = (input: {
        readonly workspaceId: string;
        readonly sectionId: string | null;
      }) =>
        Effect.gen(function* () {
          const workspace = yield* loadWorkspaceRecord(sql, input.workspaceId);
          if (isRootWorkspaceType(workspace.type) && input.sectionId !== null) {
            return yield* makeWorkspaceError(
              "The root project workspace cannot be moved into a section",
            );
          }
          if (input.sectionId !== null) {
            const section = yield* loadWorkspaceSectionRecord(sql, input.sectionId);
            if (section.projectId !== workspace.projectId) {
              return yield* makeWorkspaceError("Section does not belong to the workspace project");
            }
          }
          const tabOrder =
            input.sectionId === null
              ? yield* resolveNextTopLevelTabOrder(workspace.projectId)
              : yield* resolveNextSectionTabOrder(input.sectionId);
          const now = new Date().toISOString();
          yield* sql`
            UPDATE workspaces
            SET
              section_id = ${input.sectionId},
              tab_order = ${tabOrder},
              updated_at = ${now}
            WHERE id = ${workspace.id}
          `.pipe(Effect.mapError((cause) => makeWorkspaceError("Failed to move workspace", cause)));
          return yield* loadWorkspaceRecord(sql, workspace.id);
        });

      const deleteWorkspace = (workspaceId: string) =>
        Effect.gen(function* () {
          const workspace = yield* loadWorkspaceRecord(sql, workspaceId);
          if (isRootWorkspaceType(workspace.type)) {
            return yield* makeWorkspaceError("The root project workspace cannot be deleted");
          }

          const preview = yield* getWorkspaceDeletePreview(workspaceId);
          if (preview.totalThreadCount > 0) {
            return yield* makeWorkspaceError(
              "Delete or move workspace threads before deleting this workspace",
            );
          }

          const projectRoot = yield* loadProjectWorkspaceRoot(sql, workspace.projectId);
          const worktreeRows =
            workspace.worktreeId !== null
              ? yield* sql<WorktreeDbRow>`
                  SELECT
                    id,
                    project_id AS "projectId",
                    path,
                    branch,
                    base_branch AS "baseBranch",
                    created_by_capycode AS "createdByCapycode",
                    owns_branch AS "ownsBranch"
                  FROM worktrees
                  WHERE id = ${workspace.worktreeId}
                  LIMIT 1
                `.pipe(
                  Effect.mapError((cause) =>
                    makeWorkspaceError("Failed to inspect workspace worktree", cause),
                  ),
                )
              : [];
          const worktree = worktreeRows[0];

          if (worktree && worktree.createdByCapycode === 1) {
            yield* git
              .removeWorktree({
                cwd: projectRoot,
                path: worktree.path,
                ...(worktree.ownsBranch === 1 ? { branchToDelete: worktree.branch } : {}),
                force: true,
              })
              .pipe(
                Effect.mapError((cause) =>
                  makeWorkspaceError("Failed to remove workspace worktree", cause),
                ),
              );
          }

          yield* sql`
            DELETE FROM workspaces
            WHERE id = ${workspaceId}
          `.pipe(
            Effect.mapError((cause) => makeWorkspaceError("Failed to delete workspace", cause)),
          );

          if (workspace.worktreeId !== null) {
            yield* sql`
              DELETE FROM worktrees
              WHERE id = ${workspace.worktreeId}
            `.pipe(
              Effect.mapError((cause) =>
                makeWorkspaceError("Failed to delete worktree record", cause),
              ),
            );
          }

          const fallbackWorkspaceRows = yield* sql<{ readonly id: string }>`
            SELECT id
            FROM workspaces
            WHERE project_id = ${workspace.projectId}
              AND deleting_at IS NULL
            ORDER BY is_default DESC, tab_order ASC, id ASC
            LIMIT 1
          `.pipe(
            Effect.mapError((cause) =>
              makeWorkspaceError("Failed to resolve fallback workspace", cause),
            ),
          );
          const now = new Date().toISOString();
          yield* sql`
            INSERT INTO workspace_project_state (
              project_id,
              active_workspace_id,
              updated_at
            )
            VALUES (
              ${workspace.projectId},
              ${fallbackWorkspaceRows[0]?.id ?? null},
              ${now}
            )
            ON CONFLICT (project_id)
            DO UPDATE SET
              active_workspace_id = excluded.active_workspace_id,
              updated_at = excluded.updated_at
          `.pipe(
            Effect.mapError((cause) =>
              makeWorkspaceError("Failed to update active workspace after deletion", cause),
            ),
          );
        });

      return WsRpcGroup.of({
        [ORCHESTRATION_WS_METHODS.getSnapshot]: (_input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.getSnapshot,
            projectionSnapshotQuery.getSnapshot().pipe(
              Effect.mapError(
                (cause) =>
                  new OrchestrationGetSnapshotError({
                    message: "Failed to load orchestration snapshot",
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.dispatchCommand,
            Effect.gen(function* () {
              const normalizedCommand = yield* normalizeDispatchCommand(command);
              const result = yield* dispatchNormalizedCommand(normalizedCommand);
              if (normalizedCommand.type === "thread.archive") {
                yield* terminalManager.close({ threadId: normalizedCommand.threadId }).pipe(
                  Effect.catch((error) =>
                    Effect.logWarning("failed to close thread terminals after archive", {
                      threadId: normalizedCommand.threadId,
                      error: error.message,
                    }),
                  ),
                );
              }
              return result;
            }).pipe(
              Effect.mapError((cause) =>
                Schema.is(OrchestrationDispatchCommandError)(cause)
                  ? cause
                  : new OrchestrationDispatchCommandError({
                      message: "Failed to dispatch orchestration command",
                      cause,
                    }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.getTurnDiff]: (input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.getTurnDiff,
            checkpointDiffQuery.getTurnDiff(input).pipe(
              Effect.mapError(
                (cause) =>
                  new OrchestrationGetTurnDiffError({
                    message: "Failed to load turn diff",
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.getFullThreadDiff]: (input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.getFullThreadDiff,
            checkpointDiffQuery.getFullThreadDiff(input).pipe(
              Effect.mapError(
                (cause) =>
                  new OrchestrationGetFullThreadDiffError({
                    message: "Failed to load full thread diff",
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.replayEvents]: (input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.replayEvents,
            Stream.runCollect(
              orchestrationEngine.readEvents(
                clamp(input.fromSequenceExclusive, {
                  maximum: Number.MAX_SAFE_INTEGER,
                  minimum: 0,
                }),
              ),
            ).pipe(
              Effect.map((events) => Array.from(events)),
              Effect.flatMap(enrichOrchestrationEvents),
              Effect.mapError(
                (cause) =>
                  new OrchestrationReplayEventsError({
                    message: "Failed to replay orchestration events",
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [WS_METHODS.subscribeOrchestrationDomainEvents]: (_input) =>
          observeRpcStreamEffect(
            WS_METHODS.subscribeOrchestrationDomainEvents,
            Effect.gen(function* () {
              const snapshot = yield* orchestrationEngine.getReadModel();
              const fromSequenceExclusive = snapshot.snapshotSequence;
              const replayEvents: Array<OrchestrationEvent> = yield* Stream.runCollect(
                orchestrationEngine.readEvents(fromSequenceExclusive),
              ).pipe(
                Effect.map((events) => Array.from(events)),
                Effect.flatMap(enrichOrchestrationEvents),
                Effect.catch(() => Effect.succeed([] as Array<OrchestrationEvent>)),
              );
              const replayStream = Stream.fromIterable(replayEvents);
              const liveStream = orchestrationEngine.streamDomainEvents.pipe(
                Stream.mapEffect(enrichProjectEvent),
              );
              const source = Stream.merge(replayStream, liveStream);
              type SequenceState = {
                readonly nextSequence: number;
                readonly pendingBySequence: Map<number, OrchestrationEvent>;
              };
              const state = yield* Ref.make<SequenceState>({
                nextSequence: fromSequenceExclusive + 1,
                pendingBySequence: new Map<number, OrchestrationEvent>(),
              });

              return source.pipe(
                Stream.mapEffect((event) =>
                  Ref.modify(
                    state,
                    ({
                      nextSequence,
                      pendingBySequence,
                    }): [Array<OrchestrationEvent>, SequenceState] => {
                      if (event.sequence < nextSequence || pendingBySequence.has(event.sequence)) {
                        return [[], { nextSequence, pendingBySequence }];
                      }

                      const updatedPending = new Map(pendingBySequence);
                      updatedPending.set(event.sequence, event);

                      const emit: Array<OrchestrationEvent> = [];
                      let expected = nextSequence;
                      for (;;) {
                        const expectedEvent = updatedPending.get(expected);
                        if (!expectedEvent) {
                          break;
                        }
                        emit.push(expectedEvent);
                        updatedPending.delete(expected);
                        expected += 1;
                      }

                      return [emit, { nextSequence: expected, pendingBySequence: updatedPending }];
                    },
                  ),
                ),
                Stream.flatMap((events) => Stream.fromIterable(events)),
              );
            }),
            { "rpc.aggregate": "orchestration" },
          ),
        [WS_METHODS.serverGetConfig]: (_input) =>
          observeRpcEffect(WS_METHODS.serverGetConfig, loadServerConfig, {
            "rpc.aggregate": "server",
          }),
        [WS_METHODS.serverRefreshProviders]: (_input) =>
          observeRpcEffect(
            WS_METHODS.serverRefreshProviders,
            providerRegistry.refresh().pipe(Effect.map((providers) => ({ providers }))),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverUpsertKeybinding]: (rule) =>
          observeRpcEffect(
            WS_METHODS.serverUpsertKeybinding,
            Effect.gen(function* () {
              const keybindingsConfig = yield* keybindings.upsertKeybindingRule(rule);
              return { keybindings: keybindingsConfig, issues: [] };
            }),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverGetSettings]: (_input) =>
          observeRpcEffect(WS_METHODS.serverGetSettings, serverSettings.getSettings, {
            "rpc.aggregate": "server",
          }),
        [WS_METHODS.serverUpdateSettings]: ({ patch }) =>
          observeRpcEffect(WS_METHODS.serverUpdateSettings, serverSettings.updateSettings(patch), {
            "rpc.aggregate": "server",
          }),
        [WS_METHODS.usageGetDashboard]: ({ range }) =>
          observeRpcEffect(WS_METHODS.usageGetDashboard, usageService.getDashboard(range), {
            "rpc.aggregate": "usage",
          }),
        [WS_METHODS.usageRefreshDashboard]: ({ range }) =>
          observeRpcEffect(WS_METHODS.usageRefreshDashboard, usageService.refreshDashboard(range), {
            "rpc.aggregate": "usage",
          }),
        [WS_METHODS.projectsCreateDirectory]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsCreateDirectory,
            workspaceFileSystem.createDirectory(input).pipe(
              Effect.mapError((cause) => {
                const code = Schema.is(WorkspacePathOutsideRootError)(cause)
                  ? "outside_root"
                  : toProjectMutationCode(cause.code);
                const message = Schema.is(WorkspacePathOutsideRootError)(cause)
                  ? "Workspace file path must stay within the project root."
                  : `Failed to create workspace directory: ${cause.detail}`;
                return new ProjectCreateDirectoryError({
                  code,
                  message,
                  cause,
                });
              }),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.projectsDeleteEntry]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsDeleteEntry,
            workspaceFileSystem.deleteEntry(input).pipe(
              Effect.mapError((cause) => {
                const code = Schema.is(WorkspacePathOutsideRootError)(cause)
                  ? "outside_root"
                  : toProjectMutationCode(cause.code);
                const message = Schema.is(WorkspacePathOutsideRootError)(cause)
                  ? "Workspace file path must stay within the project root."
                  : `Failed to delete workspace entry: ${cause.detail}`;
                return new ProjectDeleteEntryError({
                  code,
                  message,
                  cause,
                });
              }),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.projectsSearchEntries]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsSearchEntries,
            workspaceEntries.search(input).pipe(
              Effect.mapError(
                (cause) =>
                  new ProjectSearchEntriesError({
                    code: "not_found",
                    message: `Failed to search workspace entries: ${cause.detail}`,
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.projectsListDirectory]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsListDirectory,
            workspaceFileSystem.listDirectory(input).pipe(
              Effect.mapError((cause) => {
                const code = Schema.is(WorkspacePathOutsideRootError)(cause)
                  ? "outside_root"
                  : toProjectMutationCode(cause.code);
                const message = Schema.is(WorkspacePathOutsideRootError)(cause)
                  ? "Workspace file path must stay within the project root."
                  : `Failed to list workspace directory: ${cause.detail}`;
                return new ProjectListDirectoryError({
                  code,
                  message,
                  cause,
                });
              }),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.projectsMoveEntry]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsMoveEntry,
            workspaceFileSystem.moveEntry(input).pipe(
              Effect.mapError((cause) => {
                const code = Schema.is(WorkspacePathOutsideRootError)(cause)
                  ? "outside_root"
                  : toProjectMutationCode(cause.code);
                const message = Schema.is(WorkspacePathOutsideRootError)(cause)
                  ? "Workspace file path must stay within the project root."
                  : `Failed to move workspace entry: ${cause.detail}`;
                return new ProjectMoveEntryError({
                  code,
                  message,
                  cause,
                });
              }),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.projectsReadFile]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsReadFile,
            workspaceFileSystem.readFile(input).pipe(
              Effect.mapError((cause) => {
                const code = Schema.is(WorkspacePathOutsideRootError)(cause)
                  ? "outside_root"
                  : toProjectMutationCode(cause.code);
                const message = Schema.is(WorkspacePathOutsideRootError)(cause)
                  ? "Workspace file path must stay within the project root."
                  : `Failed to read workspace file: ${cause.detail}`;
                return new ProjectReadFileError({
                  code,
                  message,
                  cause,
                });
              }),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.projectsWriteFile]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsWriteFile,
            workspaceFileSystem.writeFile(input).pipe(
              Effect.mapError((cause) => {
                const code = Schema.is(WorkspacePathOutsideRootError)(cause)
                  ? "outside_root"
                  : toProjectMutationCode(cause.code);
                const message = Schema.is(WorkspacePathOutsideRootError)(cause)
                  ? "Workspace file path must stay within the project root."
                  : `Failed to write workspace file: ${cause.detail}`;
                return new ProjectWriteFileError({
                  code,
                  message,
                  cause,
                });
              }),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.workspacesUpdate]: (input: WorkspaceUpdateInput) =>
          observeRpcEffect(WS_METHODS.workspacesUpdate, updateWorkspace(input), {
            "rpc.aggregate": "workspace",
          }),
        [WS_METHODS.workspacesSetActive]: (input: WorkspaceSetActiveInput) =>
          observeRpcEffect(WS_METHODS.workspacesSetActive, setActiveWorkspace(input.workspaceId), {
            "rpc.aggregate": "workspace",
          }),
        [WS_METHODS.workspacesGetDeletePreview]: (input: WorkspaceDeleteInput) =>
          observeRpcEffect(
            WS_METHODS.workspacesGetDeletePreview,
            getWorkspaceDeletePreview(input.workspaceId),
            {
              "rpc.aggregate": "workspace",
            },
          ),
        [WS_METHODS.workspacesDelete]: (input: WorkspaceDeleteInput) =>
          observeRpcEffect(
            WS_METHODS.workspacesDelete,
            deleteWorkspace(input.workspaceId).pipe(Effect.as({})),
            {
              "rpc.aggregate": "workspace",
            },
          ),
        [WS_METHODS.workspacesListOpenCandidates]: (input: WorkspaceProjectInput) =>
          observeRpcEffect(
            WS_METHODS.workspacesListOpenCandidates,
            listOpenCandidates(input.projectId),
            {
              "rpc.aggregate": "workspace",
            },
          ),
        [WS_METHODS.workspacesOpenTrackedWorktree]: (input: WorkspaceOpenTrackedWorktreeInput) =>
          observeRpcEffect(
            WS_METHODS.workspacesOpenTrackedWorktree,
            openTrackedWorktree(input.worktreeId),
            {
              "rpc.aggregate": "workspace",
            },
          ),
        [WS_METHODS.workspacesOpenExternalWorktree]: (input: WorkspaceOpenExternalWorktreeInput) =>
          observeRpcEffect(WS_METHODS.workspacesOpenExternalWorktree, openExternalWorktree(input), {
            "rpc.aggregate": "workspace",
          }),
        [WS_METHODS.workspacesImportAll]: (input: WorkspaceImportAllInput) =>
          observeRpcEffect(WS_METHODS.workspacesImportAll, importAllWorkspaces(input.projectId), {
            "rpc.aggregate": "workspace",
          }),
        [WS_METHODS.workspacesCreateSection]: (input: WorkspaceSectionCreateInput) =>
          observeRpcEffect(WS_METHODS.workspacesCreateSection, createWorkspaceSection(input), {
            "rpc.aggregate": "workspace",
          }),
        [WS_METHODS.workspacesRenameSection]: (input: WorkspaceSectionRenameInput) =>
          observeRpcEffect(WS_METHODS.workspacesRenameSection, renameWorkspaceSection(input), {
            "rpc.aggregate": "workspace",
          }),
        [WS_METHODS.workspacesDeleteSection]: (input: WorkspaceSectionDeleteInput) =>
          observeRpcEffect(
            WS_METHODS.workspacesDeleteSection,
            deleteWorkspaceSection(input.sectionId).pipe(Effect.as({})),
            {
              "rpc.aggregate": "workspace",
            },
          ),
        [WS_METHODS.workspacesSetSectionColor]: (input: WorkspaceSectionColorInput) =>
          observeRpcEffect(WS_METHODS.workspacesSetSectionColor, setWorkspaceSectionColor(input), {
            "rpc.aggregate": "workspace",
          }),
        [WS_METHODS.workspacesToggleSectionCollapsed]: (
          input: WorkspaceSectionToggleCollapsedInput,
        ) =>
          observeRpcEffect(
            WS_METHODS.workspacesToggleSectionCollapsed,
            toggleWorkspaceSectionCollapsed(input),
            {
              "rpc.aggregate": "workspace",
            },
          ),
        [WS_METHODS.workspacesReorderProjectChildren]: (
          input: WorkspaceReorderProjectChildrenInput,
        ) =>
          observeRpcEffect(
            WS_METHODS.workspacesReorderProjectChildren,
            reorderProjectChildren(input).pipe(Effect.as({})),
            {
              "rpc.aggregate": "workspace",
            },
          ),
        [WS_METHODS.workspacesReorderSectionWorkspaces]: (
          input: WorkspaceReorderSectionWorkspacesInput,
        ) =>
          observeRpcEffect(
            WS_METHODS.workspacesReorderSectionWorkspaces,
            reorderSectionWorkspaces(input).pipe(Effect.as({})),
            {
              "rpc.aggregate": "workspace",
            },
          ),
        [WS_METHODS.workspacesMoveToSection]: (input: WorkspaceMoveToSectionInput) =>
          observeRpcEffect(WS_METHODS.workspacesMoveToSection, moveWorkspaceToSection(input), {
            "rpc.aggregate": "workspace",
          }),
        [WS_METHODS.shellOpenInEditor]: (input) =>
          observeRpcEffect(WS_METHODS.shellOpenInEditor, open.openInEditor(input), {
            "rpc.aggregate": "workspace",
          }),
        [WS_METHODS.subscribeGitStatus]: (input) =>
          observeRpcStream(
            WS_METHODS.subscribeGitStatus,
            gitStatusBroadcaster.streamStatus(input),
            {
              "rpc.aggregate": "git",
            },
          ),
        [WS_METHODS.gitRefreshStatus]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitRefreshStatus,
            gitStatusBroadcaster.refreshStatus(input.cwd),
            {
              "rpc.aggregate": "git",
            },
          ),
        [WS_METHODS.gitPull]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitPull,
            git.pullCurrentBranch(input.cwd).pipe(
              Effect.matchCauseEffect({
                onFailure: (cause) => Effect.failCause(cause),
                onSuccess: (result) =>
                  refreshGitStatus(input.cwd).pipe(Effect.ignore({ log: true }), Effect.as(result)),
              }),
            ),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitRunStackedAction]: (input) =>
          observeRpcStream(
            WS_METHODS.gitRunStackedAction,
            Stream.callback<GitActionProgressEvent, GitManagerServiceError>((queue) =>
              gitManager
                .runStackedAction(input, {
                  actionId: input.actionId,
                  progressReporter: {
                    publish: (event) => Queue.offer(queue, event).pipe(Effect.asVoid),
                  },
                })
                .pipe(
                  Effect.matchCauseEffect({
                    onFailure: (cause) => Queue.failCause(queue, cause),
                    onSuccess: () =>
                      refreshGitStatus(input.cwd).pipe(
                        Effect.andThen(Queue.end(queue).pipe(Effect.asVoid)),
                      ),
                  }),
                ),
            ),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitResolvePullRequest]: (input) =>
          observeRpcEffect(WS_METHODS.gitResolvePullRequest, gitManager.resolvePullRequest(input), {
            "rpc.aggregate": "git",
          }),
        [WS_METHODS.gitPreparePullRequestThread]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitPreparePullRequestThread,
            gitManager
              .preparePullRequestThread(input)
              .pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitListRepositories]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitListRepositories,
            gitRepositoryCatalog.listRepositories(input),
            {
              "rpc.aggregate": "git",
            },
          ),
        [WS_METHODS.gitListBranches]: (input) =>
          observeRpcEffect(WS_METHODS.gitListBranches, git.listBranches(input), {
            "rpc.aggregate": "git",
          }),
        [WS_METHODS.gitGetReviewStatus]: (input) =>
          observeRpcEffect(WS_METHODS.gitGetReviewStatus, git.getReviewStatus(input), {
            "rpc.aggregate": "git",
          }),
        [WS_METHODS.gitListCommits]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitListCommits,
            git.listCommitsAheadOfBase(input.cwd, input.baseBranch),
            {
              "rpc.aggregate": "git",
            },
          ),
        [WS_METHODS.gitGetCommitFiles]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitGetCommitFiles,
            git.getCommitFiles(input.cwd, input.commitHash).pipe(
              Effect.map((files) => ({
                files: [...files],
              })),
            ),
            {
              "rpc.aggregate": "git",
            },
          ),
        [WS_METHODS.gitGetFileDiff]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitGetFileDiff,
            git.getFileDiff(input).pipe(
              Effect.map((patch) => ({
                patch,
              })),
            ),
            {
              "rpc.aggregate": "git",
            },
          ),
        [WS_METHODS.gitCreateWorktree]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitCreateWorktree,
            git.createWorktree(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitRemoveWorktree]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitRemoveWorktree,
            git.removeWorktree(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitCreateBranch]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitCreateBranch,
            git.createBranch(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitCheckout]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitCheckout,
            Effect.scoped(git.checkoutBranch(input)).pipe(
              Effect.tap(() => refreshGitStatus(input.cwd)),
            ),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitInit]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitInit,
            git.initRepo(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.terminalOpen]: (input) =>
          observeRpcEffect(WS_METHODS.terminalOpen, terminalManager.open(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.terminalWrite]: (input) =>
          observeRpcEffect(WS_METHODS.terminalWrite, terminalManager.write(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.terminalResize]: (input) =>
          observeRpcEffect(WS_METHODS.terminalResize, terminalManager.resize(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.terminalClear]: (input) =>
          observeRpcEffect(WS_METHODS.terminalClear, terminalManager.clear(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.terminalRestart]: (input) =>
          observeRpcEffect(WS_METHODS.terminalRestart, terminalManager.restart(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.terminalClose]: (input) =>
          observeRpcEffect(WS_METHODS.terminalClose, terminalManager.close(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.subscribeTerminalEvents]: (_input) =>
          observeRpcStream(
            WS_METHODS.subscribeTerminalEvents,
            Stream.callback<TerminalEvent>((queue) =>
              Effect.acquireRelease(
                terminalManager.subscribe((event) => Queue.offer(queue, event)),
                (unsubscribe) => Effect.sync(unsubscribe),
              ),
            ),
            { "rpc.aggregate": "terminal" },
          ),
        [WS_METHODS.subscribeServerConfig]: (_input) =>
          observeRpcStreamEffect(
            WS_METHODS.subscribeServerConfig,
            Effect.gen(function* () {
              const keybindingsUpdates = keybindings.streamChanges.pipe(
                Stream.map((event) => ({
                  version: 1 as const,
                  type: "keybindingsUpdated" as const,
                  payload: {
                    issues: event.issues,
                  },
                })),
              );
              const providerStatuses = providerRegistry.streamChanges.pipe(
                Stream.map((providers) => ({
                  version: 1 as const,
                  type: "providerStatuses" as const,
                  payload: { providers },
                })),
              );
              const settingsUpdates = serverSettings.streamChanges.pipe(
                Stream.map((settings) => ({
                  version: 1 as const,
                  type: "settingsUpdated" as const,
                  payload: { settings },
                })),
              );

              return Stream.concat(
                Stream.make({
                  version: 1 as const,
                  type: "snapshot" as const,
                  config: yield* loadServerConfig,
                }),
                Stream.merge(keybindingsUpdates, Stream.merge(providerStatuses, settingsUpdates)),
              );
            }),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.subscribeServerLifecycle]: (_input) =>
          observeRpcStreamEffect(
            WS_METHODS.subscribeServerLifecycle,
            Effect.gen(function* () {
              const snapshot = yield* lifecycleEvents.snapshot;
              const snapshotEvents = Array.from(snapshot.events).toSorted(
                (left, right) => left.sequence - right.sequence,
              );
              const liveEvents = lifecycleEvents.stream.pipe(
                Stream.filter((event) => event.sequence > snapshot.sequence),
              );
              return Stream.concat(Stream.fromIterable(snapshotEvents), liveEvents);
            }),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.subscribeUsage]: (_input) =>
          observeRpcStreamEffect(
            WS_METHODS.subscribeUsage,
            Effect.gen(function* () {
              const snapshot = yield* usageService.getDashboard(DEFAULT_USAGE_RANGE).pipe(
                Effect.catchTag("UsageDashboardError", () =>
                  Effect.succeed({
                    providers: [],
                    fetchedAt: new Date().toISOString(),
                  }),
                ),
              );
              return Stream.concat(
                Stream.make({
                  type: "snapshot" as const,
                  snapshot,
                }),
                usageService.streamChanges,
              );
            }),
            { "rpc.aggregate": "usage" },
          ),
        [WS_METHODS.subscribeAuthAccess]: (_input) =>
          observeRpcStreamEffect(
            WS_METHODS.subscribeAuthAccess,
            Effect.gen(function* () {
              const initialSnapshot = yield* loadAuthAccessSnapshot();
              const revisionRef = yield* Ref.make(1);
              const accessChanges: Stream.Stream<
                BootstrapCredentialChange | SessionCredentialChange
              > = Stream.merge(bootstrapCredentials.streamChanges, sessions.streamChanges);

              const liveEvents: Stream.Stream<AuthAccessStreamEvent> = accessChanges.pipe(
                Stream.mapEffect((change) =>
                  Ref.updateAndGet(revisionRef, (revision) => revision + 1).pipe(
                    Effect.map((revision) =>
                      toAuthAccessStreamEvent(change, revision, currentSessionId),
                    ),
                  ),
                ),
              );

              return Stream.concat(
                Stream.make({
                  version: 1 as const,
                  revision: 1,
                  type: "snapshot" as const,
                  payload: initialSnapshot,
                }),
                liveEvents,
              );
            }),
            { "rpc.aggregate": "auth" },
          ),
      });
    }),
  );

export const websocketRpcRouteLayer = Layer.unwrap(
  Effect.succeed(
    HttpRouter.add(
      "GET",
      "/ws",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const serverAuth = yield* ServerAuth;
        const sessions = yield* SessionCredentialService;
        const session = yield* serverAuth.authenticateWebSocketUpgrade(request);
        const rpcWebSocketHttpEffect = yield* RpcServer.toHttpEffectWebsocket(WsRpcGroup, {
          spanPrefix: "ws.rpc",
          spanAttributes: {
            "rpc.transport": "websocket",
            "rpc.system": "effect-rpc",
          },
        }).pipe(
          Effect.provide(
            makeWsRpcLayer(session.sessionId).pipe(Layer.provideMerge(RpcSerialization.layerJson)),
          ),
        );
        return yield* Effect.acquireUseRelease(
          sessions.markConnected(session.sessionId),
          () => rpcWebSocketHttpEffect,
          () => sessions.markDisconnected(session.sessionId),
        );
      }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
    ),
  ),
);
