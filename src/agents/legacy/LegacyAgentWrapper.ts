/**
 * Legacy Agent Wrapper - Wrap existing agents/*.md for event-driven system
 *
 * Allows existing Claude Code agents defined in agents/*.md to work
 * within the new event-driven architecture by:
 * - Spawning them via `claude --print --agent`
 * - Mapping inputs/outputs to event types
 * - Providing consistent error handling
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { AgentBase } from '../AgentBase.js';
import {
  AgentDefinition,
  ExecutionContext,
  ExecutionResult,
  EventType,
  PhaseName,
} from '../../events/EventTypes.js';

export interface LegacyAgentConfig {
  agentName: PhaseName;
  agentMdPath: string;
  outputMapping: Record<string, string>; // phase output name -> expected file path
}

export class LegacyAgentWrapper extends AgentBase {
  private config: LegacyAgentConfig;

  constructor(
    eventBus: import('../../events/EventBus.js').EventBus,
    definition: AgentDefinition,
    config: LegacyAgentConfig
  ) {
    super(eventBus, definition);
    this.config = config;
  }

  /**
   * Execute the legacy agent via claude --print --agent
   */
  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    return this.run(context, async () => {
      const output = await this.runLegacyAgent(context);
      return { outputs: output.files };
    });
  }

  /**
   * Run the legacy Claude Code agent
   */
  private runLegacyAgent(
    context: ExecutionContext
  ): Promise<{ files: string[]; output: string }> {
    return new Promise((resolve, reject) => {
      const prompt = this.buildPrompt(context);
      const escapedPrompt = prompt.replace(/'/g, "'\\''");
      const cmd = `claude --print --dangerously-skip-permissions --agent "${this.config.agentName}" '${escapedPrompt}'`;

      const proc = spawn('bash', ['-c', cmd], {
        cwd: context.workDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          const files = this.extractOutputFiles(context);
          resolve({ files, output: stdout });
        } else {
          reject(new Error(`Agent ${this.config.agentName} failed (${code}): ${stderr}`));
        }
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Build the prompt for the legacy agent
   */
  private buildPrompt(context: ExecutionContext): string {
    // This creates a context-rich prompt based on the phase
    switch (this.config.agentName) {
      case 'PLANNER':
        return this.buildPlannerPrompt(context);
      case 'ARCHITECT':
        return this.buildArchitectPrompt(context);
      case 'COMPOSER':
        return this.buildComposerPrompt(context);
      case 'WRITER':
        return this.buildWriterPrompt(context);
      case 'OBSERVER':
        return this.buildObserverPrompt(context);
      case 'AUDITOR':
        return this.buildAuditorPrompt(context);
      case 'REVISER':
        return this.buildReviserPrompt(context);
      case 'NORMALIZER':
        return this.buildNormalizerPrompt(context);
      case 'EDITOR':
        return this.buildEditorPrompt(context);
      case 'FACTS-KEEPER':
        return this.buildFactsKeeperPrompt(context);
      default:
        return this.buildDefaultPrompt(context);
    }
  }

  private buildPlannerPrompt(context: ExecutionContext): string {
    return `Execute PLANNER phase.

Book ID: ${context.bookId}
Chapter: ${context.chapterNumber}
Platform: ${context.platform}
Work directory: ${context.workDir}

Read these files and produce 01-intent.md:
- ${context.stateDir}/author_intent.json
- ${context.stateDir}/current_state.json
- ${context.stateDir}/pending_hooks.json
- ${context.stateDir}/chapter_summaries.json

Context: ${context.metadata?.userContext || '继续故事，保持连贯性'}

Output: Write to ${context.runtimeDir}/01-intent.md`;
  }

  private buildArchitectPrompt(context: ExecutionContext): string {
    return `Execute ARCHITECT phase.

Book ID: ${context.bookId}
Chapter: ${context.chapterNumber}
Platform: ${context.platform}
Work directory: ${context.workDir}

Read:
- ${context.runtimeDir}/01-intent.md

Output: Write to ${context.runtimeDir}/02-architecture.md`;
  }

  private buildComposerPrompt(context: ExecutionContext): string {
    return `Execute COMPOSER phase.

Book ID: ${context.bookId}
Chapter: ${context.chapterNumber}
Work directory: ${context.workDir}

Read:
- ${context.runtimeDir}/01-intent.md
- ${context.stateDir}/chapter_summaries.json
- ${context.stateDir}/pending_hooks.json
- ${context.stateDir}/particle_ledger.json
- ${context.stateDir}/character_matrix.json
- ${context.stateDir}/emotional_arcs.json

Output:
- Write to ${context.runtimeDir}/03-context.json
- Write to ${context.runtimeDir}/04-rule-stack.yaml`;
  }

  private buildWriterPrompt(context: ExecutionContext): string {
    return `Execute WRITER phase.

Book ID: ${context.bookId}
Chapter: ${context.chapterNumber}
Platform: ${context.platform}
Work directory: ${context.workDir}

IMPORTANT: Follow these anti-AI-taste rules STRICTLY:
- NEVER use: 因此、然而、但是、于是、总之、可见、众所周知
- NEVER use: 此时、此刻、就在这时、不由得、情不自禁
- NEVER use: 猛然、骤然、陡然、猝然、霍然、缓缓、渐渐、逐步
- Vary sentence length and paragraph structure
- Show emotions through actions, not statements
- Include sensory details in each scene
- End chapter with a HOOK for readers

Read:
- ${context.runtimeDir}/01-intent.md
- ${context.runtimeDir}/02-architecture.md
- ${context.runtimeDir}/03-context.json
- ${context.runtimeDir}/04-rule-stack.yaml

Output: Write to ${context.runtimeDir}/05-draft.md`;
  }

  private buildObserverPrompt(context: ExecutionContext): string {
    return `Execute OBSERVER phase.

Book ID: ${context.bookId}
Chapter: ${context.chapterNumber}
Work directory: ${context.workDir}

Read:
- ${context.runtimeDir}/05-draft.md

Output: Write to ${context.runtimeDir}/06-facts.json`;
  }

  private buildAuditorPrompt(context: ExecutionContext): string {
    return `Execute AUDITOR phase.

Book ID: ${context.bookId}
Chapter: ${context.chapterNumber}
Work directory: ${context.workDir}

IMPORTANT: Read all files using the Read tool. Do NOT paste file contents in your response.

Read these files:
- ${context.runtimeDir}/05-draft.md (chapter draft)
- ${context.runtimeDir}/06-facts.json (extracted facts)
- ${context.stateDir}/current_state.json
- ${context.stateDir}/pending_hooks.json
- ${context.stateDir}/character_matrix.json
- ${context.stateDir}/emotional_arcs.json

Check:
1. AI taste: banned words, banned sentence patterns
2. Continuity: character emotions, abilities, relationships
3. Platform poison points: 番茄 anti-patterns

Output: Write to ${context.runtimeDir}/07-audit.json

If CRITICAL issues found, report ## PIPELINE PAUSE REQUIRED`;
  }

  private buildReviserPrompt(context: ExecutionContext): string {
    return `Execute REVISER phase.

Book ID: ${context.bookId}
Chapter: ${context.chapterNumber}
Work directory: ${context.workDir}

Read:
- ${context.runtimeDir}/05-draft.md
- ${context.runtimeDir}/07-audit.json
- ${context.runtimeDir}/01-intent.md

IMPORTANT: Preserve must-keep scenes from 01-intent.md.
Auto-fix CRITICAL and HIGH issues.

Output: Write to ${context.runtimeDir}/08-revised.md`;
  }

  private buildNormalizerPrompt(context: ExecutionContext): string {
    const platformConfig = context.platform === 'tangfan'
      ? { ideal: 2800, min: 2520, max: 3080 }
      : { ideal: 4000, min: 3600, max: 4400 };

    return `Execute NORMALIZER phase.

Book ID: ${context.bookId}
Chapter: ${context.chapterNumber}
Platform: ${context.platform}
Work directory: ${context.workDir}

Target word count (${context.platform}):
- Ideal: ${platformConfig.ideal}
- Acceptable range: ${platformConfig.min}-${platformConfig.max}

Read:
- ${context.runtimeDir}/08-revised.md

DO NOT cut climax/resolution/must-keep scenes.

Output: Write to ${context.runtimeDir}/09-normalized.md`;
  }

  private buildEditorPrompt(context: ExecutionContext): string {
    const format = context.platform === 'tangfan'
      ? 'chapter_title: "第{n}章 {title}", paragraph_separator: empty line, chapter_hook: 6 spaces'
      : 'chapter_title: "第{n}章 {title}", paragraph_separator: \\n, first_line_indent: full-width';

    return `Execute EDITOR phase.

Book ID: ${context.bookId}
Chapter: ${context.chapterNumber}
Platform: ${context.platform}
Work directory: ${context.workDir}

${context.platform} format:
- ${format}

Read:
- ${context.runtimeDir}/09-normalized.md

Output:
- Write to ${context.runtimeDir}/10-final.md
- Write to ${context.booksDir}/ch-${String(context.chapterNumber).padStart(3, '0')}.md`;
  }

  private buildFactsKeeperPrompt(context: ExecutionContext): string {
    return `Execute FACTS-KEEPER phase.

Book ID: ${context.bookId}
Chapter: ${context.chapterNumber}
Work directory: ${context.workDir}

Read:
- ${context.runtimeDir}/06-facts.json
- ${context.stateDir}/current_state.json
- ${context.stateDir}/particle_ledger.json
- ${context.stateDir}/pending_hooks.json
- ${context.stateDir}/chapter_summaries.json
- ${context.stateDir}/subplot_board.json
- ${context.stateDir}/emotional_arcs.json
- ${context.stateDir}/character_matrix.json

Update all 7 truth files atomically.
- Increment chapter number in current_state.json
- Append chapter summary to chapter_summaries.json
- Update other files based on facts extracted

Output: Update these files in ${context.stateDir}/:`;
  }

  private buildDefaultPrompt(context: ExecutionContext): string {
    return `Execute ${this.config.agentName} phase.

Book ID: ${context.bookId}
Chapter: ${context.chapterNumber}
Work directory: ${context.workDir}

Output directory: ${context.runtimeDir}`;
  }

  /**
   * Extract expected output files based on agent type
   */
  private extractOutputFiles(context: ExecutionContext): string[] {
    const n = String(context.chapterNumber).padStart(3, '0');
    const base = context.runtimeDir;

    switch (this.config.agentName) {
      case 'PLANNER':
        return [`${base}/01-intent.md`];
      case 'ARCHITECT':
        return [`${base}/02-architecture.md`];
      case 'COMPOSER':
        return [`${base}/03-context.json`, `${base}/04-rule-stack.yaml`];
      case 'WRITER':
        return [`${base}/05-draft.md`];
      case 'OBSERVER':
        return [`${base}/06-facts.json`];
      case 'AUDITOR':
        return [`${base}/07-audit.json`];
      case 'REVISER':
        return [`${base}/08-revised.md`];
      case 'NORMALIZER':
        return [`${base}/09-normalized.md`];
      case 'EDITOR':
        return [
          `${base}/10-final.md`,
          `${context.booksDir}/ch-${n}.md`,
        ];
      case 'FACTS-KEEPER':
        return [
          `${context.stateDir}/current_state.json`,
          `${context.stateDir}/particle_ledger.json`,
          `${context.stateDir}/pending_hooks.json`,
          `${context.stateDir}/chapter_summaries.json`,
          `${context.stateDir}/subplot_board.json`,
          `${context.stateDir}/emotional_arcs.json`,
          `${context.stateDir}/character_matrix.json`,
        ];
      default:
        return [];
    }
  }
}

// ============================================================
// Legacy Agent Factory
// ============================================================

export function createLegacyAgentWrapper(
  eventBus: import('../../events/EventBus.js').EventBus,
  agentName: PhaseName
): LegacyAgentWrapper | null {
  const agentsDir = path.join(process.cwd(), 'agents');
  const agentMdPath = path.join(agentsDir, `${agentName}.md`);

  // Check if agent definition exists
  try {
    require('fs').accessSync(agentMdPath);
  } catch {
    console.warn(`Agent definition not found: ${agentMdPath}`);
    return null;
  }

  const definition: AgentDefinition = {
    name: agentName,
    description: `${agentName} agent (legacy)`,
    inputs: [],
    outputs: [],
    capabilities: [],
    model: agentName === 'WRITER' ? 'opus' : 'sonnet',
    tools: ['Read', 'Write'],
  };

  return new LegacyAgentWrapper(eventBus, definition, {
    agentName,
    agentMdPath,
    outputMapping: {},
  });
}
