import fsPromises from "node:fs/promises";
import { basename, join, relative as relativePathFrom, resolve as resolvePath } from "node:path";

import { Cache, Data, Duration, Effect, Exit, Layer, Ref } from "effect";

import type {
  GitListRepositoriesResult,
  GitRepositoryEntry,
  GitRepositoryEntryKind,
} from "@capycode/contracts";
import { GitCore } from "../Services/GitCore.ts";
import {
  GitRepositoryCatalog,
  type GitRepositoryCatalogShape,
} from "../Services/GitRepositoryCatalog.ts";
import { RepositoryIdentityResolver } from "../../project/Services/RepositoryIdentityResolver.ts";

const GIT_REPOSITORY_CATALOG_CACHE_TTL = Duration.seconds(15);
const GIT_REPOSITORY_CATALOG_CACHE_CAPACITY = 128;
const GIT_REPOSITORY_SCAN_READDIR_CONCURRENCY = 32;
interface DirectoryScanResult {
  readonly relativeDir: string;
  readonly directoryNames: readonly string[];
}

interface DirectoryCandidate {
  readonly relativePath: string;
  readonly absolutePath: string;
}

interface RepoMarker extends DirectoryCandidate {
  readonly hasGitRepo: boolean;
}

class RepositoryCatalogFilesystemError extends Data.TaggedError(
  "RepositoryCatalogFilesystemError",
)<{
  readonly operation: "read-directory" | "has-git-marker";
  readonly absolutePath: string;
  readonly cause: unknown;
}> {}

const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".convex",
  "node_modules",
  ".next",
  ".turbo",
  "dist",
  "build",
  "out",
  ".cache",
]);

function toPosixPath(value: string): string {
  return value.replaceAll("\\", "/");
}

function displayNameForCwd(cwd: string): string {
  return basename(cwd) || cwd;
}

function isPathWithin(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}/`);
}

function parseDeclaredSubmodulePaths(stdout: string): ReadonlySet<string> {
  const paths = new Set<string>();

  for (const line of stdout.split(/\r?\n/g)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    const match = /^submodule\.[^.]+\.path\s+(.+)$/.exec(trimmed);
    const submodulePath = match?.[1]?.trim();
    if (submodulePath) {
      paths.add(toPosixPath(submodulePath));
    }
  }

  return paths;
}

async function readDirectoryNames(absoluteDir: string): Promise<readonly string[]> {
  const dirents = await fsPromises.readdir(absoluteDir, { withFileTypes: true });
  return dirents
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name)
    .toSorted((left, right) => left.localeCompare(right));
}

async function hasGitMarker(absoluteDir: string): Promise<boolean> {
  try {
    const gitStat = await fsPromises.stat(join(absoluteDir, ".git"));
    return gitStat.isDirectory() || gitStat.isFile();
  } catch {
    return false;
  }
}

function inferParentCwd(
  discoveredRepos: ReadonlyArray<{ cwd: string; depth: number }>,
  cwd: string,
): { parentCwd: string | null; depth: number } {
  let parentCwd: string | null = null;
  let depth = 0;

  for (const candidate of discoveredRepos) {
    if (candidate.cwd === cwd || !isPathWithin(candidate.cwd, cwd)) {
      continue;
    }
    if (parentCwd === null || candidate.cwd.length > parentCwd.length) {
      parentCwd = candidate.cwd;
      depth = candidate.depth + 1;
    }
  }

  return { parentCwd, depth };
}

export const makeGitRepositoryCatalog = Effect.fn("makeGitRepositoryCatalog")(function* () {
  const gitCore = yield* GitCore;
  const repositoryIdentityResolver = yield* RepositoryIdentityResolver;
  const knownCacheKeysRef = yield* Ref.make(new Set<string>());

  const resolveRootCwd = Effect.fn("GitRepositoryCatalog.resolveRootCwd")(function* (
    cwd: string,
  ): Effect.fn.Return<string | null> {
    const result = yield* gitCore
      .execute({
        operation: "GitRepositoryCatalog.resolveRootCwd",
        cwd,
        args: ["rev-parse", "--show-toplevel"],
        allowNonZeroExit: true,
      })
      .pipe(Effect.catch(() => Effect.succeed(null)));

    if (!result || result.code !== 0) {
      return null;
    }

    const rootCwd = result.stdout.trim();
    return rootCwd.length > 0 ? resolvePath(rootCwd) : null;
  });

  const listDeclaredSubmodules = Effect.fn("GitRepositoryCatalog.listDeclaredSubmodules")(
    function* (rootCwd: string): Effect.fn.Return<ReadonlySet<string>> {
      const result = yield* gitCore
        .execute({
          operation: "GitRepositoryCatalog.listDeclaredSubmodules",
          cwd: rootCwd,
          args: ["config", "--file", ".gitmodules", "--get-regexp", "^submodule\\..*\\.path$"],
          allowNonZeroExit: true,
        })
        .pipe(Effect.catch(() => Effect.succeed(null)));

      if (!result || result.code !== 0) {
        return new Set<string>();
      }

      return new Set(parseDeclaredSubmodulePaths(result.stdout));
    },
  );

  const discoverNestedRepos = Effect.fn("GitRepositoryCatalog.discoverNestedRepos")(function* (
    rootCwd: string,
  ): Effect.fn.Return<readonly string[]> {
    const discovered = new Set<string>();
    let pendingDirectories = [""] as string[];

    while (pendingDirectories.length > 0) {
      const currentDirectories = pendingDirectories;
      pendingDirectories = [];

      const directoryEntries = yield* Effect.forEach(
        currentDirectories,
        (relativeDir) =>
          Effect.tryPromise({
            try: async (): Promise<DirectoryScanResult> => ({
              relativeDir,
              directoryNames: await readDirectoryNames(
                relativeDir ? join(rootCwd, relativeDir) : rootCwd,
              ),
            }),
            catch: (cause) =>
              new RepositoryCatalogFilesystemError({
                operation: "read-directory",
                absolutePath: relativeDir ? join(rootCwd, relativeDir) : rootCwd,
                cause,
              }),
          }).pipe(
            Effect.catch(() =>
              Effect.succeed({
                relativeDir,
                directoryNames: [] as readonly string[],
              }),
            ),
          ),
        { concurrency: GIT_REPOSITORY_SCAN_READDIR_CONCURRENCY },
      );

      const directoryCandidates = directoryEntries.flatMap(({ relativeDir, directoryNames }) =>
        directoryNames.flatMap((directoryName): readonly DirectoryCandidate[] => {
          if (!directoryName || IGNORED_DIRECTORY_NAMES.has(directoryName)) {
            return [];
          }
          const relativePath = toPosixPath(
            relativeDir ? join(relativeDir, directoryName) : directoryName,
          );
          return [{ relativePath, absolutePath: join(rootCwd, relativePath) }];
        }),
      );

      if (directoryCandidates.length === 0) {
        continue;
      }

      const allowedDirectories = new Set(
        yield* gitCore
          .filterIgnoredPaths(
            rootCwd,
            directoryCandidates.map((candidate) => candidate.relativePath),
          )
          .pipe(
            Effect.map((paths) => [...paths]),
            Effect.catch(() =>
              Effect.succeed(directoryCandidates.map((candidate) => candidate.relativePath)),
            ),
          ),
      );

      const repoMarkers = yield* Effect.forEach(
        directoryCandidates,
        (candidate) =>
          Effect.tryPromise({
            try: async (): Promise<RepoMarker> => ({
              ...candidate,
              hasGitRepo: allowedDirectories.has(candidate.relativePath)
                ? await hasGitMarker(candidate.absolutePath)
                : false,
            }),
            catch: (cause) =>
              new RepositoryCatalogFilesystemError({
                operation: "has-git-marker",
                absolutePath: candidate.absolutePath,
                cause,
              }),
          }).pipe(
            Effect.catch(() =>
              Effect.succeed({
                ...candidate,
                hasGitRepo: false,
              }),
            ),
          ),
        { concurrency: GIT_REPOSITORY_SCAN_READDIR_CONCURRENCY },
      );

      for (const candidate of repoMarkers) {
        if (!allowedDirectories.has(candidate.relativePath)) {
          continue;
        }

        pendingDirectories.push(candidate.relativePath);
        if (candidate.hasGitRepo) {
          discovered.add(toPosixPath(resolvePath(candidate.absolutePath)));
        }
      }
    }

    return [...discovered].toSorted((left, right) => {
      const byLength = left.length - right.length;
      return byLength !== 0 ? byLength : left.localeCompare(right);
    });
  });

  const readCatalog = Effect.fn("GitRepositoryCatalog.readCatalog")(function* (
    rootCwd: string,
  ): Effect.fn.Return<GitListRepositoriesResult> {
    const [declaredSubmodulePaths, nestedRepos] = yield* Effect.all(
      [listDeclaredSubmodules(rootCwd), discoverNestedRepos(rootCwd)],
      { concurrency: "unbounded" },
    );

    const normalizedRootCwd = toPosixPath(resolvePath(rootCwd));
    const repoCwds = [normalizedRootCwd, ...nestedRepos.filter((cwd) => cwd !== normalizedRootCwd)];
    const discoveredRepos: Array<{ cwd: string; depth: number }> = [];
    const repositories: GitRepositoryEntry[] = [];

    for (const repoCwd of repoCwds) {
      const normalizedRelativePath =
        repoCwd === normalizedRootCwd
          ? "."
          : toPosixPath(relativePathFrom(normalizedRootCwd, repoCwd));
      const { parentCwd, depth } =
        repoCwd === normalizedRootCwd
          ? { parentCwd: null, depth: 0 }
          : inferParentCwd(discoveredRepos, repoCwd);
      const kind: GitRepositoryEntryKind =
        repoCwd === normalizedRootCwd
          ? "root"
          : declaredSubmodulePaths.has(normalizedRelativePath)
            ? "submodule"
            : "nested";
      const repositoryIdentity = yield* repositoryIdentityResolver.resolve(repoCwd);

      repositories.push({
        cwd: repoCwd,
        rootCwd: normalizedRootCwd,
        parentCwd,
        relativePath: normalizedRelativePath,
        name: displayNameForCwd(repoCwd),
        kind,
        depth,
        repositoryIdentity,
      });
      discoveredRepos.push({ cwd: repoCwd, depth });
    }

    return {
      rootCwd: normalizedRootCwd,
      repositories,
    } satisfies GitListRepositoriesResult;
  });

  const repositoryCatalogCache = yield* Cache.makeWith(readCatalog, {
    capacity: GIT_REPOSITORY_CATALOG_CACHE_CAPACITY,
    timeToLive: (exit) => (Exit.isSuccess(exit) ? GIT_REPOSITORY_CATALOG_CACHE_TTL : Duration.zero),
  });

  const listRepositories: GitRepositoryCatalogShape["listRepositories"] = Effect.fn(
    "GitRepositoryCatalog.listRepositories",
  )(function* (input): Effect.fn.Return<GitListRepositoriesResult, never> {
    const rootCwd = yield* resolveRootCwd(input.cwd);
    if (!rootCwd) {
      return {
        rootCwd: toPosixPath(resolvePath(input.cwd)),
        repositories: [],
      };
    }

    yield* Ref.update(knownCacheKeysRef, (keys) => new Set(keys).add(rootCwd));
    return yield* Cache.get(repositoryCatalogCache, rootCwd);
  });

  const invalidateAll: GitRepositoryCatalogShape["invalidateAll"] = Effect.fn(
    "GitRepositoryCatalog.invalidateAll",
  )(function* () {
    const cacheKeys = yield* Ref.get(knownCacheKeysRef);
    yield* Effect.forEach(
      cacheKeys,
      (cacheKey) => Cache.invalidate(repositoryCatalogCache, cacheKey),
      {
        concurrency: "unbounded",
        discard: true,
      },
    );
  });

  return {
    listRepositories,
    invalidateAll,
  } satisfies GitRepositoryCatalogShape;
}) as () => Effect.Effect<GitRepositoryCatalogShape, never, GitCore | RepositoryIdentityResolver>;

export const GitRepositoryCatalogLive = Layer.effect(
  GitRepositoryCatalog,
  makeGitRepositoryCatalog(),
);
