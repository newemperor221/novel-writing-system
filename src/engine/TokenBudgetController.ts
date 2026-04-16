/**
 * Token Budget Controller - Context truncation and pruning for long novels
 *
 * Addresses the "长篇会崩" problem by:
 * - Truncating chapter_summaries.json to keep only recent N chapters
 * - Pruning resolved hooks from pending_hooks.json
 * - Limiting particle_ledger.json to recent N entries
 * - Archiving older chapter summaries as one-line stubs
 */

import { promises as fs } from 'fs';
import * as path from 'path';

export interface TokenBudgetConfig {
  maxTokens: number;              // Target context size (default 8000)
  chapterSummaryWindow: number;   // Keep full summaries for last N chapters (default 10)
  particleLedgerWindow: number;   // Keep last N resource entries (default 20)
  archiveOlderSummaries: boolean; // Archive old summaries as stubs (default true)
}

const DEFAULT_CONFIG: TokenBudgetConfig = {
  maxTokens: 8000,
  chapterSummaryWindow: 10,
  particleLedgerWindow: 20,
  archiveOlderSummaries: true,
};

export interface TruncatedContext {
  files: string[];                    // Paths to truncated files
  sizes: Record<string, number>;     // Approximate token count per file
  totalTokens: number;                // Estimated total
}

export class TokenBudgetController {
  private config: TokenBudgetConfig;
  private workDir: string;

  constructor(workDir: string, config: Partial<TokenBudgetConfig> = {}) {
    this.workDir = workDir;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Build truncated context for COMPOSER phase
   */
  async buildContext(bookId: string): Promise<TruncatedContext> {
    const stateDir = path.join(this.workDir, 'state', bookId);
    const archiveDir = path.join(stateDir, 'archive');
    const sizes: Record<string, number> = {};
    const files: string[] = [];

    await fs.mkdir(archiveDir, { recursive: true });

    // 1. Truncate chapter_summaries.json
    const chapterSummaryPath = path.join(stateDir, 'chapter_summaries.json');
    try {
      const truncated = await this.truncateChapterSummaries(bookId, chapterSummaryPath, archiveDir);
      files.push(truncated);
      sizes[truncated] = await this.estimateTokens(truncated);
    } catch {
      // File doesn't exist yet, skip
    }

    // 2. Prune pending_hooks.json
    const hooksPath = path.join(stateDir, 'pending_hooks.json');
    try {
      const pruned = await this.pruneResolvedHooks(bookId, hooksPath);
      files.push(pruned);
      sizes[pruned] = await this.estimateTokens(pruned);
    } catch {
      // File doesn't exist yet, skip
    }

    // 3. Limit particle_ledger.json
    const ledgerPath = path.join(stateDir, 'particle_ledger.json');
    try {
      const limited = await this.limitParticleLedger(bookId, ledgerPath);
      files.push(limited);
      sizes[limited] = await this.estimateTokens(limited);
    } catch {
      // File doesn't exist yet, skip
    }

    // 4. Return unmodified files as-is
    const currentStatePath = path.join(stateDir, 'current_state.json');
    const characterMatrixPath = path.join(stateDir, 'character_matrix.json');
    const emotionalArcsPath = path.join(stateDir, 'emotional_arcs.json');
    const subplotBoardPath = path.join(stateDir, 'subplot_board.json');

    for (const p of [currentStatePath, characterMatrixPath, emotionalArcsPath, subplotBoardPath]) {
      try {
        await fs.access(p);
        files.push(p);
        sizes[p] = await this.estimateTokens(p);
      } catch {
        // File doesn't exist yet, skip
      }
    }

    const totalTokens = Object.values(sizes).reduce((a, b) => a + b, 0);

    return { files, sizes, totalTokens };
  }

  /**
   * Truncate chapter_summaries.json: keep last N full, archive older ones
   */
  private async truncateChapterSummaries(
    bookId: string,
    filePath: string,
    archiveDir: string
  ): Promise<string> {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);

    if (!Array.isArray(data)) return filePath;

    const total = data.length;
    const keepFull = this.config.chapterSummaryWindow;
    const toArchive = data.slice(0, total - keepFull);
    const toKeep = data.slice(total - keepFull);

    if (toArchive.length === 0) return filePath;

    // Archive older summaries as one-line stubs
    if (this.config.archiveOlderSummaries) {
      const archivePath = path.join(archiveDir, 'chapter_summaries_archive.json');
      const existing: object[] = [];

      try {
        const existingContent = await fs.readFile(archivePath, 'utf-8');
        const parsed = JSON.parse(existingContent);
        if (Array.isArray(parsed)) {
          existing.push(...parsed);
        }
      } catch {
        // Archive doesn't exist yet
      }

      const newStubs = toArchive.map((ch: any) => ({
        chapter: ch.chapter,
        stub: `${ch.chapter}: ${ch.summary?.slice(0, 50) || '（无摘要）'}...`,
      }));

      await fs.writeFile(
        archivePath,
        JSON.stringify([...existing, ...newStubs], null, 2),
        'utf-8'
      );
    }

    // Write truncated file with only recent chapters
    await fs.writeFile(filePath, JSON.stringify(toKeep, null, 2), 'utf-8');

    return filePath;
  }

  /**
   * Remove resolved hooks from pending_hooks.json
   */
  private async pruneResolvedHooks(bookId: string, filePath: string): Promise<string> {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);

    if (!data.hooks || !Array.isArray(data.hooks)) return filePath;

    const before = data.hooks.length;
    data.hooks = data.hooks.filter((h: any) => h.status !== 'resolved');
    const after = data.hooks.length;

    if (before === after) return filePath;

    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return filePath;
  }

  /**
   * Keep only recent N entries in particle_ledger.json
   */
  private async limitParticleLedger(bookId: string, filePath: string): Promise<string> {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);

    if (!data.entries || !Array.isArray(data.entries)) return filePath;

    const window = this.config.particleLedgerWindow;
    if (data.entries.length <= window) return filePath;

    // Keep the most recent entries
    data.entries = data.entries.slice(-window);

    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return filePath;
  }

  /**
   * Estimate token count for a file (rough approximation)
   */
  private async estimateTokens(filePath: string): Promise<number> {
    try {
      const stat = await fs.stat(filePath);
      if (stat.isDirectory()) return 0;
      const content = await fs.readFile(filePath, 'utf-8');
      // Rough estimate: ~4 characters per token for Chinese text
      return Math.ceil(content.length / 4);
    } catch {
      return 0;
    }
  }

  /**
   * Get current budget utilization
   */
  async getUtilization(bookId: string): Promise<{
    used: number;
    limit: number;
    utilization: number;
  }> {
    const context = await this.buildContext(bookId);
    return {
      used: context.totalTokens,
      limit: this.config.maxTokens,
      utilization: context.totalTokens / this.config.maxTokens,
    };
  }
}
