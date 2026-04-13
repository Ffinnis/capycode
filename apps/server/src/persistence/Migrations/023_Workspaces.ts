import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const threadColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  const hasWorkspaceIdColumn = threadColumns.some((column) => column.name === "workspace_id");
  const hasBranchColumn = threadColumns.some((column) => column.name === "branch");

  yield* sql`
    CREATE TABLE IF NOT EXISTS worktrees (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      path TEXT NOT NULL,
      branch TEXT NOT NULL,
      base_branch TEXT,
      created_at TEXT NOT NULL,
      created_by_capycode INTEGER NOT NULL DEFAULT 1
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS workspace_sections (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      tab_order INTEGER NOT NULL,
      is_collapsed INTEGER NOT NULL DEFAULT 0,
      color TEXT,
      created_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      worktree_id TEXT,
      type TEXT NOT NULL,
      branch TEXT,
      name TEXT NOT NULL,
      tab_order INTEGER NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_opened_at TEXT NOT NULL,
      deleting_at TEXT,
      section_id TEXT
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS workspace_project_state (
      project_id TEXT PRIMARY KEY,
      active_workspace_id TEXT,
      updated_at TEXT NOT NULL
    )
  `;

  if (!hasWorkspaceIdColumn) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN workspace_id TEXT
    `;
  }

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_worktrees_project_id
    ON worktrees(project_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_worktrees_project_path
    ON worktrees(project_id, path)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_workspace_sections_project_id
    ON workspace_sections(project_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_workspaces_project_id
    ON workspaces(project_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_workspaces_project_branch
    ON workspaces(project_id, branch)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_workspaces_project_worktree_id
    ON workspaces(project_id, worktree_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_threads_workspace_id
    ON projection_threads(workspace_id)
  `;

  if (hasBranchColumn) {
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
      SELECT
        lower(hex(randomblob(16))),
        projects.project_id,
        NULL,
        'branch',
        COALESCE(
          (
            SELECT threads.branch
            FROM projection_threads AS threads
            WHERE
              threads.project_id = projects.project_id
              AND threads.deleted_at IS NULL
              AND threads.branch IS NOT NULL
            ORDER BY threads.created_at ASC, threads.thread_id ASC
            LIMIT 1
          ),
          'main'
        ),
        COALESCE(
          (
            SELECT threads.branch
            FROM projection_threads AS threads
            WHERE
              threads.project_id = projects.project_id
              AND threads.deleted_at IS NULL
              AND threads.branch IS NOT NULL
            ORDER BY threads.created_at ASC, threads.thread_id ASC
            LIMIT 1
          ),
          'main'
        ),
        0,
        1,
        projects.created_at,
        projects.updated_at,
        projects.updated_at,
        NULL,
        NULL
      FROM projection_projects AS projects
      WHERE
        projects.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM workspaces
          WHERE workspaces.project_id = projects.project_id
        )
    `;
  } else {
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
      SELECT
        lower(hex(randomblob(16))),
        projects.project_id,
        NULL,
        'branch',
        'main',
        'main',
        0,
        1,
        projects.created_at,
        projects.updated_at,
        projects.updated_at,
        NULL,
        NULL
      FROM projection_projects AS projects
      WHERE
        projects.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM workspaces
          WHERE workspaces.project_id = projects.project_id
        )
    `;
  }

  yield* sql`
    INSERT INTO workspace_project_state (
      project_id,
      active_workspace_id,
      updated_at
    )
    SELECT
      projects.project_id,
      (
        SELECT workspaces.id
        FROM workspaces
        WHERE workspaces.project_id = projects.project_id
        ORDER BY workspaces.is_default DESC, workspaces.tab_order ASC, workspaces.id ASC
        LIMIT 1
      ),
      projects.updated_at
    FROM projection_projects AS projects
    WHERE
      projects.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM workspace_project_state
        WHERE workspace_project_state.project_id = projects.project_id
      )
  `;

  if (hasBranchColumn) {
    yield* sql`
      UPDATE projection_threads
      SET workspace_id = COALESCE(
        (
          SELECT workspaces.id
          FROM workspaces
          WHERE
            workspaces.project_id = projection_threads.project_id
            AND projection_threads.branch IS NOT NULL
            AND workspaces.branch = projection_threads.branch
          ORDER BY
            workspaces.is_default DESC,
            workspaces.tab_order ASC,
            workspaces.id ASC
          LIMIT 1
        ),
        (
          SELECT workspaces.id
          FROM workspaces
          WHERE workspaces.project_id = projection_threads.project_id
          ORDER BY
            workspaces.is_default DESC,
            workspaces.tab_order ASC,
            workspaces.id ASC
          LIMIT 1
        )
      )
      WHERE workspace_id IS NULL
    `;
  } else {
    yield* sql`
      UPDATE projection_threads
      SET workspace_id = (
        SELECT workspaces.id
        FROM workspaces
        WHERE workspaces.project_id = projection_threads.project_id
        ORDER BY
          workspaces.is_default DESC,
          workspaces.tab_order ASC,
          workspaces.id ASC
        LIMIT 1
      )
      WHERE workspace_id IS NULL
    `;
  }
});
