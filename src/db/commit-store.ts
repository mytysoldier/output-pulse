import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { commits } from "./schema/index.js";
import type { UpsertResult } from "./upsert-result.js";

export interface PersistedCommit {
  repositoryId: number;
  sha: string;
  authorGithubUserId: number;
  committedAt: Date;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export interface CommitStore {
  /**
   * コミットをrepository IDとSHAでUpsertし、再同期時は最終確認日時と可変情報を更新する。
   */
  upsertCommits(commits: PersistedCommit[]): Promise<UpsertResult | undefined>;
}

/**
 * 同期したコミットをDBへ保存するCommitStoreを作成する。既存コミットの初回確認日時は保持する。
 */
export function createCommitStore(database: NodePgDatabase): CommitStore {
  return {
    /**
     * 新規コミットを挿入し、同じrepository IDとSHAがある場合はauthor・コミット時刻・最終確認日時を更新する。
     */
    async upsertCommits(persistedCommits) {
      if (persistedCommits.length === 0) {
        return { insertedCount: 0, updatedCount: 0 };
      }

      const results = await database
        .insert(commits)
        .values(persistedCommits)
        .onConflictDoUpdate({
          target: [commits.repositoryId, commits.sha],
          set: {
            authorGithubUserId: sql`excluded.${sql.identifier(commits.authorGithubUserId.name)}`,
            committedAt: sql`excluded.${sql.identifier(commits.committedAt.name)}`,
            lastSeenAt: sql`excluded.${sql.identifier(commits.lastSeenAt.name)}`,
          },
        })
        .returning({ inserted: sql<boolean>`xmax = 0` });

      return countUpserts(results);
    },
  };
}

function countUpserts(results: Array<{ inserted: boolean }>): UpsertResult {
  const insertedCount = results.filter((result) => result.inserted).length;
  return { insertedCount, updatedCount: results.length - insertedCount };
}
