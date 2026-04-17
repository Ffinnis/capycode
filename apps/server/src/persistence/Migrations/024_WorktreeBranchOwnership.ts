import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const worktreeColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(worktrees)
  `;
  const hasCreatedByCapycodeColumn = worktreeColumns.some(
    (column) => column.name === "created_by_capycode",
  );
  const hasOwnsBranchColumn = worktreeColumns.some((column) => column.name === "owns_branch");

  if (!hasCreatedByCapycodeColumn) {
    yield* sql`
      ALTER TABLE worktrees
      ADD COLUMN created_by_capycode INTEGER NOT NULL DEFAULT 1
    `;
  }

  if (!hasOwnsBranchColumn) {
    yield* sql`
      ALTER TABLE worktrees
      ADD COLUMN owns_branch INTEGER NOT NULL DEFAULT 0
    `;
  }

  yield* sql`
    UPDATE worktrees
    SET owns_branch = CASE
      WHEN created_by_capycode = 1
        AND base_branch IS NOT NULL
        AND branch != base_branch
      THEN 1
      ELSE 0
    END
  `;
});
