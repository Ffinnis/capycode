import { Context } from "effect";
import type { Effect } from "effect";
import type {
  GitCommandError,
  GitListRepositoriesInput,
  GitListRepositoriesResult,
} from "@capycode/contracts";

export interface GitRepositoryCatalogShape {
  readonly listRepositories: (
    input: GitListRepositoriesInput,
  ) => Effect.Effect<GitListRepositoriesResult, GitCommandError>;
  readonly invalidateAll: () => Effect.Effect<void, never>;
}

export class GitRepositoryCatalog extends Context.Service<
  GitRepositoryCatalog,
  GitRepositoryCatalogShape
>()("t3/git/Services/GitRepositoryCatalog") {}
