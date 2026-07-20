import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { completedIssues } from "./schema/index.js";
import type { UpsertResult } from "./upsert-result.js";

export interface PersistedCompletedIssue {
  firstClosedAt: Date;
  githubNodeId: string;
  lastSeenAt: Date;
  matchedByAuthor: boolean;
  matchedByClosingPr: boolean;
  number: number;
  repositoryId: number;
  title: string;
  visibility: string;
}

export interface CompletedIssueStore {
  refreshCompletedIssues?(issues: PersistedCompletedIssue[]): Promise<UpsertResult | undefined>;
  upsertCompletedIssues(issues: PersistedCompletedIssue[]): Promise<UpsertResult | undefined>;
}

export function createCompletedIssueStore(database: NodePgDatabase): CompletedIssueStore {
  return {
    async upsertCompletedIssues(synchronizedIssues) {
      if (synchronizedIssues.length === 0) {
        return { insertedCount: 0, updatedCount: 0 };
      }

      const results = await database
        .insert(completedIssues)
        .values(synchronizedIssues)
        .onConflictDoUpdate({
          target: completedIssues.githubNodeId,
          set: {
            repositoryId: sql`excluded.${sql.identifier(completedIssues.repositoryId.name)}`,
            number: sql`excluded.${sql.identifier(completedIssues.number.name)}`,
            title: sql`excluded.${sql.identifier(completedIssues.title.name)}`,
            matchedByAuthor: sql`${completedIssues.matchedByAuthor} OR excluded.${sql.identifier(completedIssues.matchedByAuthor.name)}`,
            matchedByClosingPr: sql`${completedIssues.matchedByClosingPr} OR excluded.${sql.identifier(completedIssues.matchedByClosingPr.name)}`,
            visibility: sql`excluded.${sql.identifier(completedIssues.visibility.name)}`,
            lastSeenAt: sql`excluded.${sql.identifier(completedIssues.lastSeenAt.name)}`,
          },
        })
        .returning({ inserted: sql<boolean>`xmax = 0` });

      return countUpserts(results);
    },

    async refreshCompletedIssues(refreshedIssues) {
      if (refreshedIssues.length === 0) {
        return { insertedCount: 0, updatedCount: 0 };
      }

      const results = await Promise.all(
        refreshedIssues.map((issue) =>
          database
            .update(completedIssues)
            .set({
              title: issue.title,
              matchedByAuthor: sql`${completedIssues.matchedByAuthor} OR ${issue.matchedByAuthor}`,
              matchedByClosingPr: sql`${completedIssues.matchedByClosingPr} OR ${issue.matchedByClosingPr}`,
              visibility: issue.visibility,
              lastSeenAt: issue.lastSeenAt,
            })
            .where(eq(completedIssues.githubNodeId, issue.githubNodeId))
            .returning({ githubNodeId: completedIssues.githubNodeId }),
        ),
      );

      return { insertedCount: 0, updatedCount: results.flat().length };
    },
  };
}

function countUpserts(results: Array<{ inserted: boolean }>): UpsertResult {
  const insertedCount = results.filter((result) => result.inserted).length;
  return { insertedCount, updatedCount: results.length - insertedCount };
}
