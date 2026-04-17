import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("025_RootWorkspaceOnly", (it) => {
  it.effect("collapses legacy branch workspaces into the single root workspace", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 24 });

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-1',
          'Project 1',
          '/tmp/project-1',
          NULL,
          '[]',
          '2026-04-17T00:00:00.000Z',
          '2026-04-17T00:00:00.000Z',
          NULL
        )
      `;

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
        VALUES
          (
            'workspace-root',
            'project-1',
            NULL,
            'branch',
            'main',
            'main',
            0,
            1,
            '2026-04-17T00:00:00.000Z',
            '2026-04-17T00:00:00.000Z',
            '2026-04-17T00:00:00.000Z',
            NULL,
            NULL
          ),
          (
            'workspace-feature-a',
            'project-1',
            NULL,
            'branch',
            'feature/a',
            'Feature A',
            1,
            0,
            '2026-04-17T00:00:00.000Z',
            '2026-04-17T00:00:00.000Z',
            '2026-04-17T00:00:00.000Z',
            NULL,
            NULL
          ),
          (
            'workspace-feature-b',
            'project-1',
            NULL,
            'branch',
            'feature/b',
            'Feature B',
            2,
            0,
            '2026-04-17T00:00:00.000Z',
            '2026-04-17T00:00:00.000Z',
            '2026-04-17T00:00:00.000Z',
            NULL,
            NULL
          ),
          (
            'workspace-feature-deleted',
            'project-1',
            NULL,
            'branch',
            'feature/deleted',
            'Feature Deleted',
            3,
            0,
            '2026-04-17T00:00:00.000Z',
            '2026-04-17T00:00:00.000Z',
            '2026-04-17T00:00:00.000Z',
            '2026-04-17T01:00:00.000Z',
            NULL
          )
      `;

      yield* sql`
        INSERT INTO workspace_project_state (
          project_id,
          active_workspace_id,
          updated_at
        )
        VALUES (
          'project-1',
          'workspace-feature-deleted',
          '2026-04-17T00:00:00.000Z'
        )
      `;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          workspace_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          archived_at,
          deleted_at
        )
        VALUES
          (
            'thread-root',
            'project-1',
            'workspace-root',
            'Root thread',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'default',
            'main',
            NULL,
            NULL,
            '2026-04-17T00:00:00.000Z',
            '2026-04-17T00:00:00.000Z',
            NULL,
            NULL
          ),
          (
            'thread-feature-a',
            'project-1',
            'workspace-feature-a',
            'Feature thread A',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'default',
            'feature/a',
            NULL,
            NULL,
            '2026-04-17T00:00:00.000Z',
            '2026-04-17T00:00:00.000Z',
            NULL,
            NULL
          ),
          (
            'thread-feature-b',
            'project-1',
            'workspace-feature-b',
            'Feature thread B',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'default',
            'feature/b',
            NULL,
            NULL,
            '2026-04-17T00:00:00.000Z',
            '2026-04-17T00:00:00.000Z',
            NULL,
            NULL
          ),
          (
            'thread-feature-deleted',
            'project-1',
            'workspace-feature-deleted',
            'Feature thread deleted',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'default',
            'feature/deleted',
            NULL,
            NULL,
            '2026-04-17T00:00:00.000Z',
            '2026-04-17T00:00:00.000Z',
            NULL,
            NULL
          )
      `;

      yield* runMigrations({ toMigrationInclusive: 25 });

      const workspaceRows = yield* sql<{
        readonly id: string;
        readonly type: string;
        readonly name: string;
      }>`
        SELECT
          id,
          type,
          name
        FROM workspaces
        WHERE project_id = 'project-1'
        ORDER BY tab_order ASC, id ASC
      `;
      assert.deepStrictEqual(workspaceRows, [
        {
          id: "workspace-root",
          type: "root",
          name: "Workspace",
        },
      ]);

      const threadRows = yield* sql<{
        readonly threadId: string;
        readonly workspaceId: string | null;
      }>`
        SELECT
          thread_id AS "threadId",
          workspace_id AS "workspaceId"
        FROM projection_threads
        WHERE project_id = 'project-1'
        ORDER BY thread_id ASC
      `;
      assert.deepStrictEqual(threadRows, [
        { threadId: "thread-feature-a", workspaceId: "workspace-root" },
        { threadId: "thread-feature-b", workspaceId: "workspace-root" },
        { threadId: "thread-feature-deleted", workspaceId: "workspace-root" },
        { threadId: "thread-root", workspaceId: "workspace-root" },
      ]);

      const activeWorkspaceRows = yield* sql<{
        readonly activeWorkspaceId: string | null;
      }>`
        SELECT active_workspace_id AS "activeWorkspaceId"
        FROM workspace_project_state
        WHERE project_id = 'project-1'
      `;
      assert.deepStrictEqual(activeWorkspaceRows, [{ activeWorkspaceId: "workspace-root" }]);
    }),
  );
});
