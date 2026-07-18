import { and, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { repositories, trackedActors } from "./schema/index.js";

export interface PersistedRepository {
  githubRepositoryId: number;
  ownerGithubUserId: number;
  visibility: string;
  defaultBranch: string;
  isFork: boolean;
  isArchived: boolean;
}

export interface TrackedActor {
  githubUserId: number;
  githubLogin: string;
  actorType: "bot" | "user";
}

export interface TargetStore {
  listEnabledTrackedActors(): Promise<TrackedActor[]>;
  upsertRepositories(repositories: PersistedRepository[]): Promise<void>;
}

export function createTargetStore(database: NodePgDatabase): TargetStore {
  return {
    async listEnabledTrackedActors() {
      const actors = await database
        .select({
          githubUserId: trackedActors.githubUserId,
          githubLogin: trackedActors.githubLogin,
          actorType: trackedActors.actorType,
        })
        .from(trackedActors)
        .where(
          and(eq(trackedActors.enabled, true), inArray(trackedActors.actorType, ["user", "bot"])),
        );

      return actors.filter(
        (actor): actor is TrackedActor => actor.actorType === "bot" || actor.actorType === "user",
      );
    },

    async upsertRepositories(targetRepositories) {
      if (targetRepositories.length === 0) {
        return;
      }

      await database
        .insert(repositories)
        .values(targetRepositories)
        .onConflictDoUpdate({
          target: repositories.githubRepositoryId,
          set: {
            ownerGithubUserId: repositories.ownerGithubUserId,
            visibility: repositories.visibility,
            defaultBranch: repositories.defaultBranch,
            isFork: repositories.isFork,
            isArchived: repositories.isArchived,
          },
        });
    },
  };
}
