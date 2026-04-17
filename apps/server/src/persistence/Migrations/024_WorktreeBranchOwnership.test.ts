import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("024_WorktreeBranchOwnership", (it) => {
  it.effect("repairs legacy worktrees tables that are missing metadata columns", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 22 });

      yield* sql`
        CREATE TABLE worktrees (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          path TEXT NOT NULL,
          branch TEXT NOT NULL,
          base_branch TEXT,
          created_at TEXT NOT NULL
        )
      `;

      yield* sql`
        INSERT INTO worktrees (
          id,
          project_id,
          path,
          branch,
          base_branch,
          created_at
        )
        VALUES (
          'worktree-1',
          'project-1',
          '/tmp/project-1-feature-a',
          'feature/a',
          'main',
          '2026-01-01T00:00:00.000Z'
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 24 });

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(worktrees)
      `;
      assert.ok(columns.some((column) => column.name === "created_by_capycode"));
      assert.ok(columns.some((column) => column.name === "owns_branch"));

      const rows = yield* sql<{
        readonly createdByCapycode: number;
        readonly ownsBranch: number;
      }>`
        SELECT
          created_by_capycode AS "createdByCapycode",
          owns_branch AS "ownsBranch"
        FROM worktrees
        WHERE id = 'worktree-1'
      `;

      assert.deepStrictEqual(rows, [{ createdByCapycode: 1, ownsBranch: 1 }]);
    }),
  );
});
