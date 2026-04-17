import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    UPDATE workspaces
    SET
      type = 'root',
      name = 'Workspace',
      section_id = NULL
    WHERE is_default = 1
      AND deleting_at IS NULL
  `;

  yield* sql`
    UPDATE projection_threads
    SET workspace_id = (
      SELECT root_workspaces.id
      FROM workspaces AS root_workspaces
      WHERE root_workspaces.project_id = projection_threads.project_id
        AND root_workspaces.is_default = 1
        AND root_workspaces.deleting_at IS NULL
      ORDER BY root_workspaces.tab_order ASC, root_workspaces.id ASC
      LIMIT 1
    )
    WHERE workspace_id IN (
      SELECT branch_workspaces.id
      FROM workspaces AS branch_workspaces
      WHERE branch_workspaces.type = 'branch'
        AND branch_workspaces.is_default = 0
        AND branch_workspaces.deleting_at IS NULL
    )
  `;

  yield* sql`
    UPDATE workspace_project_state
    SET
      active_workspace_id = (
        SELECT root_workspaces.id
        FROM workspaces AS root_workspaces
        WHERE root_workspaces.project_id = workspace_project_state.project_id
          AND root_workspaces.is_default = 1
          AND root_workspaces.deleting_at IS NULL
        ORDER BY root_workspaces.tab_order ASC, root_workspaces.id ASC
        LIMIT 1
      )
    WHERE active_workspace_id IN (
      SELECT branch_workspaces.id
      FROM workspaces AS branch_workspaces
      WHERE branch_workspaces.project_id = workspace_project_state.project_id
        AND branch_workspaces.type = 'branch'
        AND branch_workspaces.is_default = 0
        AND branch_workspaces.deleting_at IS NULL
    )
  `;

  yield* sql`
    DELETE FROM workspaces
    WHERE type = 'branch'
      AND is_default = 0
      AND deleting_at IS NULL
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_single_root_per_project
    ON workspaces(project_id)
    WHERE type = 'root' AND deleting_at IS NULL
  `;
});
