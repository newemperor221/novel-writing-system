/**
 * Quality Aggregator - Aggregates chapter quality scores over time
 *
 * Computes 0-100 quality scores from AUDITOR's style_metrics and stores
 * them in quality_history.json for trend analysis and PLANNER feedback.
 */

import { promises as fs } from 'fs';
import * as path from 'path';

export interface ChapterQualityScore {
  chapterNumber: number;
  overallScore: number;        // 0-100
  styleScore: number;          // 去AI味得分 (0-100)
  continuityScore: number;     // 连续性得分 (0-100)
  structureScore: number;       // 结构得分 (0-100)
  auditResult: 'PASS' | 'FAIL';
  issueCounts: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  styleMetrics: StyleMetrics;
  timestamp: string;
}

export interface StyleMetrics {
  paragraph_cv: number;
  hedge_density: number;
  transition_max_count: number;
  consecutive_same_prefix: number;
  chapter_type_streak: number;
  mood_streak: number;
  title_collapse_token?: string;
  opening_dice_pair: number[];
  ending_dice_pair: number[];
}

export interface QualityTrend {
  avgOverallScore: number;
  avgStyleScore: number;
  avgContinuityScore: number;
  avgStructureScore: number;
  passRate: number;
  totalChapters: number;
  recentTrend: 'improving' | 'stable' | 'declining';
}

export class QualityAggregator {
  private workDir: string;

  constructor(workDir: string) {
    this.workDir = workDir;
  }

  /**
   * Compute quality score from AUDITOR's audit output
   */
  async computeScore(
    bookId: string,
    chapterNumber: number,
    auditResult: {
      overall_result: 'PASS' | 'FAIL';
      issues: Array<{
        severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
        dimension: string;
      }>;
      style_metrics: Partial<StyleMetrics>;
    }
  ): Promise<ChapterQualityScore> {
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const issue of auditResult.issues) {
      const key = issue.severity.toLowerCase() as keyof typeof counts;
      if (key in counts) counts[key]++;
    }

    const styleMetrics = this.normalizeStyleMetrics(auditResult.style_metrics);

    const styleScore = this.computeStyleScore(styleMetrics);
    const continuityScore = this.computeContinuityScore(styleMetrics, counts);
    const structureScore = this.computeStructureScore(styleMetrics, counts);
    const overallScore = Math.round(
      styleScore * 0.35 +
      continuityScore * 0.35 +
      structureScore * 0.30
    );

    return {
      chapterNumber,
      overallScore,
      styleScore,
      continuityScore,
      structureScore,
      auditResult: auditResult.overall_result,
      issueCounts: counts,
      styleMetrics,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Record a chapter's quality score
   */
  async recordScore(bookId: string, score: ChapterQualityScore): Promise<void> {
    const historyPath = this.getHistoryPath(bookId);
    const history = await this.loadHistory(bookId);

    history.push(score);

    // Keep only last 50 chapters for trend analysis
    const trimmed = history.slice(-50);

    await fs.writeFile(historyPath, JSON.stringify(trimmed, null, 2), 'utf-8');
  }

  /**
   * Get quality trend for a book
   */
  async getTrend(bookId: string, window = 10): Promise<QualityTrend> {
    const history = await this.loadHistory(bookId);
    if (history.length === 0) {
      return {
        avgOverallScore: 0,
        avgStyleScore: 0,
        avgContinuityScore: 0,
        avgStructureScore: 0,
        passRate: 0,
        totalChapters: 0,
        recentTrend: 'stable',
      };
    }

    const recent = history.slice(-window);
    const total = history.length;

    const avgOverallScore = Math.round(
      recent.reduce((sum, s) => sum + s.overallScore, 0) / recent.length
    );
    const avgStyleScore = Math.round(
      recent.reduce((sum, s) => sum + s.styleScore, 0) / recent.length
    );
    const avgContinuityScore = Math.round(
      recent.reduce((sum, s) => sum + s.continuityScore, 0) / recent.length
    );
    const avgStructureScore = Math.round(
      recent.reduce((sum, s) => sum + s.structureScore, 0) / recent.length
    );
    const passCount = recent.filter((s) => s.auditResult === 'PASS').length;
    const passRate = Math.round((passCount / recent.length) * 100);

    // Determine trend by comparing first half vs second half of recent window
    let recentTrend: 'improving' | 'stable' | 'declining' = 'stable';
    if (recent.length >= 4) {
      const half = Math.floor(recent.length / 2);
      const firstHalf = recent.slice(0, half);
      const secondHalf = recent.slice(half);
      const firstAvg = firstHalf.reduce((s, c) => s + c.overallScore, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((s, c) => s + c.overallScore, 0) / secondHalf.length;
      if (secondAvg - firstAvg > 3) recentTrend = 'improving';
      else if (firstAvg - secondAvg > 3) recentTrend = 'declining';
    }

    return {
      avgOverallScore,
      avgStyleScore,
      avgContinuityScore,
      avgStructureScore,
      passRate,
      totalChapters: total,
      recentTrend,
    };
  }

  /**
   * Get last N quality scores
   */
  async getRecentScores(bookId: string, count = 5): Promise<ChapterQualityScore[]> {
    const history = await this.loadHistory(bookId);
    return history.slice(-count);
  }

  // Private helpers

  private normalizeStyleMetrics(m: Partial<StyleMetrics>): StyleMetrics {
    return {
      paragraph_cv: m.paragraph_cv ?? 0,
      hedge_density: m.hedge_density ?? 0,
      transition_max_count: m.transition_max_count ?? 0,
      consecutive_same_prefix: m.consecutive_same_prefix ?? 0,
      chapter_type_streak: m.chapter_type_streak ?? 0,
      mood_streak: m.mood_streak ?? 0,
      title_collapse_token: m.title_collapse_token,
      opening_dice_pair: m.opening_dice_pair ?? [],
      ending_dice_pair: m.ending_dice_pair ?? [],
    };
  }

  /**
   * Style score: penalize AI-sounding patterns
   * - paragraph_cv < 0.15 → too uniform (bad)
   * - hedge_density > 3 → too many hedging words (bad)
   * - transition_max_count >= 3 → repetitive transitions (bad)
   */
  private computeStyleScore(m: StyleMetrics): number {
    let score = 100;

    // Paragraph uniformity (CV < 0.15 is suspicious)
    if (m.paragraph_cv < 0.15) score -= 20;
    else if (m.paragraph_cv > 0.25) score -= 5;

    // Hedge density (>3/1k is bad)
    if (m.hedge_density > 3) score -= Math.min(20, (m.hedge_density - 3) * 5);
    else if (m.hedge_density < 1.5) score += 5;

    // Transition repetition
    if (m.transition_max_count >= 3) score -= 15;
    else if (m.transition_max_count >= 2) score -= 8;

    // List-like structure
    if (m.consecutive_same_prefix >= 3) score -= 10;
    else if (m.consecutive_same_prefix === 0) score += 5;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Continuity score: based on issues found
   */
  private computeContinuityScore(m: StyleMetrics, counts: { critical: number; high: number; medium: number; low: number }): number {
    let score = 100;
    score -= counts.critical * 20;
    score -= counts.high * 8;
    score -= counts.medium * 3;
    score -= counts.low * 1;

    // Cross-chapter fatigue
    if (m.chapter_type_streak >= 3) score -= 10;
    if (m.mood_streak >= 3) score -= 8;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Structure score: paragraph/sentence organization
   */
  private computeStructureScore(m: StyleMetrics, counts: { critical: number; high: number; medium: number; low: number }): number {
    let score = 100;

    // Structure issues from audit
    if (m.paragraph_cv > 0.35) score -= 10;  // Too variable is also bad

    return Math.max(0, Math.min(100, score));
  }

  private async loadHistory(bookId: string): Promise<ChapterQualityScore[]> {
    const historyPath = this.getHistoryPath(bookId);
    try {
      const content = await fs.readFile(historyPath, 'utf-8');
      const parsed = JSON.parse(content);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private getHistoryPath(bookId: string): string {
    return path.join(this.workDir, 'state', bookId, 'quality_history.json');
  }
}
