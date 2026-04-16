/**
 * Style Perturbator - Adds randomization to reduce AI-sounding output
 *
 * Addresses the "写出来像AI" problem by:
 * - Generating random substitution tables from banned word lists
 * - Selecting varied sentence structure templates
 * - Injecting style variation instructions into WRITER prompts
 */

import { promises as fs } from 'fs';
import * as path from 'path';

export type VoiceVariant = '简洁干脆' | '舒缓悠扬' | '冷峻克制' | '热烈奔放';

export interface StyleConfig {
  temperature?: number;         // 0.0-1.0, default 0.3
  voice?: VoiceVariant;
  seed?: number;               // Random seed for reproducibility
}

interface SubstitutionEntry {
  original: string;
  alternatives: string[];
}

// Pre-built substitution tables per voice variant
const VOICE_SUBSTITUTIONS: Record<VoiceVariant, Record<string, string>> = {
  '简洁干脆': {
    '不由得': '转身',
    '情不自禁': '猛地',
    '缓缓': '立刻',
    '渐渐': '瞬间',
    '此时此刻': '眼下',
    '不由自主': '径直',
  },
  '舒缓悠扬': {
    '猛然': '慢慢',
    '骤然': '悠然',
    '陡然': '缓缓地',
    '猝然': '悄然',
    '立刻': '缓缓地',
    '瞬间': '不知不觉地',
  },
  '冷峻克制': {
    '感到': '察觉',
    '只觉得': '仅觉',
    '情不自禁': '未曾',
    '缓缓': '纹丝不动地',
    '渐渐': '始终',
    '不由得': '未曾',
  },
  '热烈奔放': {
    '缓缓': '飞快地',
    '渐渐': '一下子',
    '不由得': '激动地',
    '情不自禁': '热血沸腾地',
    '猛然': '雷霆般',
    '骤然': '狂风般',
  },
};

export class StylePerturbator {
  private workDir: string;
  private config: StyleConfig;
  private rngSeed: number;

  constructor(workDir: string, config: StyleConfig = {}) {
    this.workDir = workDir;
    this.config = {
      temperature: config.temperature ?? 0.3,
      voice: config.voice,
      seed: config.seed,
    };
    this.rngSeed = this.config.seed ?? Date.now();
  }

  /**
   * Generate a random substitution table for banned words
   * Returns a subset of banned words based on temperature
   */
  async generateSubstitutionTable(): Promise<Record<string, string>> {
    const table: Record<string, string> = {};
    const voice = this.config.voice;

    // Load all banned word files
    const fatigueDir = path.join(this.workDir, 'config', 'fatigue_lexicon');
    const bannedDir = path.join(this.workDir, 'config', 'banned_patterns');

    const files = ['high_freq_llm.txt', 'transition_fatigue.txt', 'emotion_fatigue.txt'];
    const allSubstitutions = this.loadVoiceSubstitutions();

    for (const file of files) {
      try {
        const content = await fs.readFile(path.join(fatigueDir, file), 'utf-8');
        const lines = content.split('\n').filter(Boolean);

        for (const line of lines) {
          const words = line.split(/[、,，]/).filter(Boolean);
          for (const word of words) {
            const trimmed = word.trim();
            if (!trimmed) continue;

            // Decide if this word should be substituted (based on temperature)
            if (this.random() > (this.config.temperature ?? 0.3)) continue;

            // Find alternatives from voice substitutions or defaults
            let alt: string | undefined;
            if (voice && allSubstitutions[voice]?.[trimmed]) {
              alt = allSubstitutions[voice][trimmed];
            } else if (allSubstitutions['简洁干脆']?.[trimmed]) {
              alt = allSubstitutions['简洁干脆'][trimmed];
            }

            if (alt) {
              table[trimmed] = alt;
            }
          }
        }
      } catch {
        // File doesn't exist, skip
      }
    }

    return table;
  }

  /**
   * Select random sentence templates for variety
   */
  selectSentenceTemplates(count = 3): string[] {
    const templates = [
      // Action-first templates
      '「{dialogue}」{subject}{verb}。',
      '{subject}{verb}。「{dialogue}」',
      '{adverb}{verb}，{subject}的{body}。',

      // Description-first templates
      '{setting}，{subject}{verb}。',
      '{subject}的{body}，{verb}。',
      '远处，{subject}{verb}，「{dialogue}」。',

      // Mixed POV templates
      '{subject}看着{object}，{verb}，「{dialogue}」。',
      '「{dialogue}」，{subject}{verb}，{body}。',
    ];

    const selected: string[] = [];
    for (let i = 0; i < Math.min(count, templates.length); i++) {
      const idx = this.seededRandom() % templates.length;
      selected.push(templates.splice(idx, 1)[0]);
    }

    return selected;
  }

  /**
   * Build style variation instructions for WRITER prompt
   */
  async buildStyleInstructions(): Promise<string> {
    const parts: string[] = [];

    parts.push('【风格控制】');

    // Voice variant
    if (this.config.voice) {
      parts.push(`文风变体：${this.config.voice}`);
      parts.push(this.getVoiceGuidance(this.config.voice));
    }

    // Substitution table
    const substitutions = await this.generateSubstitutionTable();
    if (Object.keys(substitutions).length > 0) {
      parts.push('【词汇替换表】（随机应用）');
      for (const [original, replacement] of Object.entries(substitutions)) {
        parts.push(`  ${original} → ${replacement}`);
      }
    }

    // Sentence templates
    const templates = this.selectSentenceTemplates(2);
    if (templates.length > 0) {
      parts.push('【句式多样性】选择以下句式模板轮换使用：');
      for (const t of templates) {
        parts.push(`  - ${t}`);
      }
    }

    // Temperature-based guidance
    const temp = this.config.temperature ?? 0.3;
    if (temp >= 0.5) {
      parts.push('【强扰动模式】积极使用短句和长句交替，减少连接词，增加动作描写比重。');
    } else if (temp >= 0.3) {
      parts.push('【中等扰动】保持句子长度变化，避免连续使用相同主语开头。');
    }

    return parts.join('\n');
  }

  /**
   * Get a randomization seed for NORMALIZER
   */
  getRandomizationSeed(): number {
    return this.rngSeed;
  }

  // Private helpers

  private getVoiceGuidance(voice: VoiceVariant): string {
    const guidance: Record<VoiceVariant, string> = {
      '简洁干脆': '句式短促有力，减少修饰词，多用动词，少用"的"字结构。',
      '舒缓悠扬': '节奏缓慢，多用副词和形容词，长句为主，情感描写细腻。',
      '冷峻克制': '少用情感词，多用白描，动作和对话为主，情感通过行为暗示。',
      '热烈奔放': '感叹句多，夸张比喻多，情感外露，节奏快，动词力度强。',
    };
    return guidance[voice] || '';
  }

  private loadVoiceSubstitutions(): Record<VoiceVariant, Record<string, string>> {
    return VOICE_SUBSTITUTIONS;
  }

  // Simple seeded random number generator (LCG)
  private seededRandom(): number {
    this.rngSeed = (this.rngSeed * 1664525 + 1013904223) & 0xffffffff;
    return (this.rngSeed >>> 0) / 0xffffffff;
  }

  private random(): number {
    return this.seededRandom();
  }
}
