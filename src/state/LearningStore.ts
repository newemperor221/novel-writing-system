/**
 * Learning Store - Tracks fix outcomes to inform future revisions
 *
 * Addresses the "缺乏反馈闭环" problem by:
 * - Recording whether each fix type worked
 * - Tracking frequent failure types per book
 * - Suggesting best fix strategies based on historical success rates
 */

import { promises as fs } from 'fs';
import * as path from 'path';

export interface FixOutcome {
  chapterNumber: number;
  issueType: string;          // e.g., 'vocabulary_fatigue', 'transition_repetition'
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  fixStrategy: string;       // e.g., 'substitute_word', 'split_paragraph'
  worked: boolean;            // Did the fix resolve the issue?
  timestamp: string;
}

export interface LearningData {
  outcomes: FixOutcome[];
  fixStrategyStats: Record<string, FixStats>;
  issueTypeStats: Record<string, IssueStats>;
}

interface FixStats {
  attempts: number;
  successes: number;
  successRate: number;
}

interface IssueStats {
  occurrences: number;
  avgSeverity: number;  // CRITICAL=4, HIGH=3, MEDIUM=2, LOW=1
}

const SEVERITY_SCORE: Record<string, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

export class LearningStore {
  private workDir: string;

  constructor(workDir: string) {
    this.workDir = workDir;
  }

  /**
   * Record the outcome of a fix attempt
   */
  async recordFixOutcome(
    bookId: string,
    chapterNumber: number,
    issueType: string,
    severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW',
    fixStrategy: string,
    worked: boolean
  ): Promise<void> {
    const data = await this.loadData(bookId);

    const outcome: FixOutcome = {
      chapterNumber,
      issueType,
      severity,
      fixStrategy,
      worked,
      timestamp: new Date().toISOString(),
    };

    data.outcomes.push(outcome);

    // Keep only last 200 outcomes to avoid unbounded growth
    data.outcomes = data.outcomes.slice(-200);

    // Update fix strategy stats
    const key = `${issueType}:${fixStrategy}`;
    if (!data.fixStrategyStats[key]) {
      data.fixStrategyStats[key] = { attempts: 0, successes: 0, successRate: 0 };
    }
    const stats = data.fixStrategyStats[key];
    stats.attempts++;
    if (worked) stats.successes++;
    stats.successRate = stats.successes / stats.attempts;

    // Update issue type stats
    if (!data.issueTypeStats[issueType]) {
      data.issueTypeStats[issueType] = { occurrences: 0, avgSeverity: 0 };
    }
    const issueStats = data.issueTypeStats[issueType];
    const prevTotal = issueStats.occurrences * issueStats.avgSeverity;
    issueStats.occurrences++;
    issueStats.avgSeverity = (prevTotal + SEVERITY_SCORE[severity]) / issueStats.occurrences;

    await this.saveData(bookId, data);
  }

  /**
   * Get most frequent failure types (issues that appear often but don't fix well)
   */
  async getFrequentFailureTypes(bookId: string, limit = 5): Promise<Array<{ type: string; occurrences: number }>> {
    const data = await this.loadData(bookId);

    const counts: Record<string, number> = {};
    for (const outcome of data.outcomes) {
      if (!outcome.worked) {
        counts[outcome.issueType] = (counts[outcome.issueType] || 0) + 1;
      }
    }

    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([type, occurrences]) => ({ type, occurrences }));
  }

  /**
   * Get the best fix strategy for a given issue type
   */
  async getBestFixStrategy(
    bookId: string,
    issueType: string
  ): Promise<string | null> {
    const data = await this.loadData(bookId);

    let best: { strategy: string; rate: number; attempts: number } | null = null;

    for (const [key, stats] of Object.entries(data.fixStrategyStats)) {
      if (!key.startsWith(`${issueType}:`)) continue;
      if (stats.attempts < 2) continue;  // Need at least 2 attempts to trust

      if (!best || stats.successRate > best.rate) {
        best = {
          strategy: key.split(':')[1],
          rate: stats.successRate,
          attempts: stats.attempts,
        };
      }
    }

    return best?.strategy ?? null;
  }

  /**
   * Get all strategies for an issue type ranked by success rate
   */
  async getStrategiesRanked(
    bookId: string,
    issueType: string
  ): Promise<Array<{ strategy: string; successRate: number; attempts: number }>> {
    const data = await this.loadData(bookId);

    const results: Array<{ strategy: string; successRate: number; attempts: number }> = [];

    for (const [key, stats] of Object.entries(data.fixStrategyStats)) {
      if (!key.startsWith(`${issueType}:`)) continue;

      results.push({
        strategy: key.split(':')[1],
        successRate: stats.successRate,
        attempts: stats.attempts,
      });
    }

    return results.sort((a, b) => b.successRate - a.successRate);
  }

  /**
   * Get learning summary for a book
   */
  async getSummary(bookId: string): Promise<{
    totalOutcomes: number;
    totalFixAttempts: number;
    overallSuccessRate: number;
    topFailingTypes: Array<{ type: string; count: number }>;
    bestStrategies: Array<{ issueType: string; strategy: string; rate: number }>;
  }> {
    const data = await this.loadData(bookId);

    const totalOutcomes = data.outcomes.length;
    const totalFixAttempts = Object.values(data.fixStrategyStats).reduce((s, v) => s + v.attempts, 0);
    const totalSuccesses = Object.values(data.fixStrategyStats).reduce((s, v) => s + v.successes, 0);
    const overallSuccessRate = totalFixAttempts > 0 ? totalSuccesses / totalFixAttempts : 0;

    const topFailing = await this.getFrequentFailureTypes(bookId, 3);
    const bestStrategies: Array<{ issueType: string; strategy: string; rate: number }> = [];

    for (const issueType of Object.keys(data.issueTypeStats)) {
      const best = await this.getBestFixStrategy(bookId, issueType);
      if (best) {
        const key = `${issueType}:${best}`;
        const stats = data.fixStrategyStats[key];
        bestStrategies.push({ issueType, strategy: best, rate: stats?.successRate ?? 0 });
      }
    }

    return {
      totalOutcomes,
      totalFixAttempts,
      overallSuccessRate: Math.round(overallSuccessRate * 100),
      topFailingTypes: topFailing.map(t => ({ type: t.type, count: t.occurrences })),
      bestStrategies: bestStrategies.slice(0, 5),
    };
  }

  // Private helpers

  private async loadData(bookId: string): Promise<LearningData> {
    const filePath = this.getPath(bookId);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return {
        outcomes: [],
        fixStrategyStats: {},
        issueTypeStats: {},
      };
    }
  }

  private async saveData(bookId: string, data: LearningData): Promise<void> {
    const filePath = this.getPath(bookId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  private getPath(bookId: string): string {
    return path.join(this.workDir, 'state', bookId, 'learning_store.json');
  }
}
