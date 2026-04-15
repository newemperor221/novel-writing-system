#!/usr/bin/env node
/**
 * Pipeline Orchestrator
 *
 * Executes the 10-phase writing pipeline by spawning each phase agent
 * using `claude --print --agent <name> "<prompt>"`.
 *
 * Each phase agent is a native Claude Code agent defined in agents/*.md
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';

const WORKFLOW_DIR = process.cwd();
const AGENTS_DIR = path.join(WORKFLOW_DIR, 'agents');
const STATE_DIR = (bookId: string) => path.join(WORKFLOW_DIR, 'state', bookId);
const RUNTIME_DIR = (bookId: string, chapter: number) =>
  path.join(WORKFLOW_DIR, 'runtime', bookId, `chapter-${String(chapter).padStart(3, '0')}`);
const BOOKS_DIR = (bookId: string) => path.join(WORKFLOW_DIR, 'books', bookId, 'chapters');

// Colors
const RED = '\x1b[0;31m';
const GREEN = '\x1b[0;32m';
const YELLOW = '\x1b[1;33m';
const BLUE = '\x1b[0;34m';
const CYAN = '\x1b[0;36m';
const NC = '\x1b[0m';

interface PipelineOptions {
  bookId: string;
  chapterNumber?: number;
  context?: string;
  skipAudit?: boolean;
  force?: boolean;
}

async function log(step: string, status: string, message: string) {
  console.log(`${BLUE}[${step}]${NC} ${status === '✓' ? GREEN : status === '✗' ? RED : YELLOW}${status}${NC} ${message}`);
}

async function runAgent(agentName: string, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    const args = ['--print', '--agent', agentName, prompt];

    log(agentName, '...', 'spawning agent');

    const proc = spawn('claude', args, {
      cwd: WORKFLOW_DIR,
      env,
      stdio: ['pipe', 'pipe', 'pipe']
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
        resolve(stdout);
      } else {
        console.error(`${RED}Agent ${agentName} failed with code ${code}${NC}`);
        console.error(stderr);
        reject(new Error(`Agent ${agentName} failed: ${stderr || 'unknown error'}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

async function callAgent(agentName: string, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Escape single quotes in prompt for bash
    const escapedPrompt = prompt.replace(/'/g, "'\\''");
    const cmd = `claude --print --dangerously-skip-permissions --agent "${agentName}" '${escapedPrompt}'`;

    const proc = spawn('bash', ['-c', cmd], {
      cwd: WORKFLOW_DIR,
      stdio: ['ignore', 'pipe', 'pipe']
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
        resolve(stdout);
      } else {
        reject(new Error(`Agent ${agentName} failed (${code}): ${stderr}`));
      }
    });

    proc.on('error', reject);
  });
}

async function ensureDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath: string): Promise<any> {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

async function getNextChapter(bookId: string): Promise<number> {
  const stateFile = path.join(STATE_DIR(bookId), 'current_state.json');
  try {
    const state = await readJson(stateFile);
    return (state.chapter || 0) + 1;
  } catch {
    return 1;
  }
}

async function getPlatform(bookId: string): Promise<string> {
  const intentFile = path.join(STATE_DIR(bookId), 'author_intent.json');
  try {
    const intent = await readJson(intentFile);
    return intent.targetPlatform || 'tangfan';
  } catch {
    return 'tangfan';
  }
}

function escapeForBash(str: string): string {
  return str.replace(/'/g, "'\\''");
}

async function runPhase(
  phaseName: string,
  agentName: string,
  prompt: string,
  expectedOutput: string
): Promise<boolean> {
  try {
    await log(phaseName, '...', `Executing ${agentName}`);
    await callAgent(agentName, prompt);

    if (expectedOutput && !(await fileExists(expectedOutput))) {
      await log(phaseName, '✗', `Output file not found: ${expectedOutput}`);
      return false;
    }

    await log(phaseName, '✓', `Completed`);
    return true;
  } catch (error) {
    await log(phaseName, '✗', `Failed: ${error}`);
    return false;
  }
}

async function runPipeline(options: PipelineOptions) {
  const { bookId, chapterNumber, context, skipAudit } = options;

  console.log(`${BLUE}╔══════════════════════════════════════════════════════╗${NC}`);
  console.log(`${BLUE}║         Native Claude Code Multi-Agent Pipeline     ║${NC}`);
  console.log(`${BLUE}╚══════════════════════════════════════════════════════╝${NC}\n`);

  // Determine chapter number
  const chapter = chapterNumber || await getNextChapter(bookId);
  const platform = await getPlatform(bookId);
  const runtimePath = RUNTIME_DIR(bookId, chapter);
  const booksPath = BOOKS_DIR(bookId);

  console.log(`${GREEN}Book:${NC}     ${bookId}`);
  console.log(`${GREEN}Chapter:${NC}  ${chapter}`);
  console.log(`${GREEN}Platform:${NC} ${platform}`);
  console.log(`${GREEN}Output:${NC}   ${runtimePath}\n`);

  // Create directories
  await ensureDir(runtimePath);
  await ensureDir(booksPath);

  const workDir = WORKFLOW_DIR;

  // Phase 1: PLANNER
  console.log(`\n${YELLOW}═══ Phase 1: PLANNER ═══${NC}`);
  const plannerPrompt = `Execute PLANNER phase.

Book ID: ${bookId}
Chapter: ${chapter}
Platform: ${platform}
Work directory: ${workDir}

Read these files and produce 01-intent.md:
- ${STATE_DIR(bookId)}/author_intent.json
- ${STATE_DIR(bookId)}/current_state.json
- ${STATE_DIR(bookId)}/pending_hooks.json
- ${STATE_DIR(bookId)}/chapter_summaries.json

Context from user: ${context || '继续故事，保持连贯性'}

Output: Write to ${runtimePath}/01-intent.md`;

  if (!(await runPhase('PLANNER', 'PLANNER', plannerPrompt, `${runtimePath}/01-intent.md`))) {
    throw new Error('PLANNER phase failed');
  }

  // Phase 2: ARCHITECT
  console.log(`\n${YELLOW}═══ Phase 2: ARCHITECT ═══${NC}`);
  const architectPrompt = `Execute ARCHITECT phase.

Book ID: ${bookId}
Chapter: ${chapter}
Platform: ${platform}
Work directory: ${workDir}

Read:
- ${runtimePath}/01-intent.md

Output: Write to ${runtimePath}/02-architecture.md`;

  if (!(await runPhase('ARCHITECT', 'ARCHITECT', architectPrompt, `${runtimePath}/02-architecture.md`))) {
    throw new Error('ARCHITECT phase failed');
  }

  // Phase 3: COMPOSER
  console.log(`\n${YELLOW}═══ Phase 3: COMPOSER ═══${NC}`);
  const composerPrompt = `Execute COMPOSER phase.

Book ID: ${bookId}
Chapter: ${chapter}
Work directory: ${workDir}

Read:
- ${runtimePath}/01-intent.md
- ${STATE_DIR(bookId)}/chapter_summaries.json
- ${STATE_DIR(bookId)}/pending_hooks.json
- ${STATE_DIR(bookId)}/particle_ledger.json
- ${STATE_DIR(bookId)}/character_matrix.json
- ${STATE_DIR(bookId)}/emotional_arcs.json

Output:
- Write to ${runtimePath}/03-context.json
- Write to ${runtimePath}/04-rule-stack.yaml`;

  if (!(await runPhase('COMPOSER', 'COMPOSER', composerPrompt, `${runtimePath}/03-context.json`))) {
    throw new Error('COMPOSER phase failed');
  }

  // Phase 4: WRITER
  console.log(`\n${YELLOW}═══ Phase 4: WRITER ═══${NC}`);
  const writerPrompt = `Execute WRITER phase.

Book ID: ${bookId}
Chapter: ${chapter}
Platform: ${platform}
Work directory: ${workDir}

IMPORTANT: Follow these anti-AI-taste rules STRICTLY:
- NEVER use: 因此、然而、但是、于是、总之、可见、众所周知
- NEVER use: 此时、此刻、就在这时、不由得、情不自禁
- NEVER use: 猛然、骤然、陡然、猝然、霍然、缓缓、渐渐、逐步
- Vary sentence length and paragraph structure
- Show emotions through actions, not statements
- Include sensory details in each scene
- End chapter with a HOOK for readers

Read:
- ${runtimePath}/01-intent.md
- ${runtimePath}/02-architecture.md
- ${runtimePath}/03-context.json
- ${runtimePath}/04-rule-stack.yaml

Output: Write to ${runtimePath}/05-draft.md`;

  if (!(await runPhase('WRITER', 'WRITER', writerPrompt, `${runtimePath}/05-draft.md`))) {
    throw new Error('WRITER phase failed');
  }

  // Phase 5: OBSERVER
  console.log(`\n${YELLOW}═══ Phase 5: OBSERVER ═══${NC}`);
  const observerPrompt = `Execute OBSERVER phase.

Book ID: ${bookId}
Chapter: ${chapter}
Work directory: ${workDir}

Read:
- ${runtimePath}/05-draft.md

Output: Write to ${runtimePath}/06-facts.json`;

  if (!(await runPhase('OBSERVER', 'OBSERVER', observerPrompt, `${runtimePath}/06-facts.json`))) {
    throw new Error('OBSERVER phase failed');
  }

  // Phase 6: AUDITOR
  if (!skipAudit) {
    console.log(`\n${YELLOW}═══ Phase 6: AUDITOR ═══${NC}`);
    const auditorPrompt = `Execute AUDITOR phase.

Book ID: ${bookId}
Chapter: ${chapter}
Work directory: ${workDir}

IMPORTANT: Read all files using the Read tool. Do NOT paste file contents in your response.

Read these files:
- ${runtimePath}/05-draft.md (chapter draft)
- ${runtimePath}/06-facts.json (extracted facts)
- ${STATE_DIR(bookId)}/current_state.json
- ${STATE_DIR(bookId)}/pending_hooks.json
- ${STATE_DIR(bookId)}/character_matrix.json
- ${STATE_DIR(bookId)}/emotional_arcs.json

Check:
1. AI taste: banned words, banned sentence patterns
2. Continuity: character emotions, abilities, relationships
3. Platform poison points: 番茄 anti-patterns

Output: Write to ${runtimePath}/07-audit.json

If CRITICAL issues found, report ## PIPELINE PAUSE REQUIRED`;

    if (!(await runPhase('AUDITOR', 'AUDITOR', auditorPrompt, `${runtimePath}/07-audit.json`))) {
      throw new Error('AUDITOR phase failed');
    }

    // Check audit result
    const auditContent = await fs.readFile(`${runtimePath}/07-audit.json`, 'utf-8');
    const audit = JSON.parse(auditContent);
    const hasCritical = (audit.issues || []).some((i: any) => i.severity === 'CRITICAL');
    const auditPassed = audit.overall_result === 'PASS';

    if (hasCritical) {
      console.log(`\n${RED}═══ 🚨 CRITICAL ISSUES DETECTED ═══${NC}`);
      console.log(`${RED}Pipeline paused. Review ${runtimePath}/07-audit.json${NC}`);
      console.log(`Issues found: ${(audit.issues || []).filter((i: any) => i.severity === 'CRITICAL').length} CRITICAL`);
      throw new Error('CRITICAL issues - pipeline paused');
    }

    if (!auditPassed) {
      // Phase 7: REVISER
      console.log(`\n${YELLOW}═══ Phase 7: REVISER ═══${NC}`);
      const reviserPrompt = `Execute REVISER phase.

Book ID: ${bookId}
Chapter: ${chapter}
Work directory: ${workDir}

Read:
- ${runtimePath}/05-draft.md
- ${runtimePath}/07-audit.json
- ${runtimePath}/01-intent.md

IMPORTANT: Preserve must-keep scenes from 01-intent.md.
Auto-fix CRITICAL and HIGH issues.

Output: Write to ${runtimePath}/08-revised.md`;

      if (!(await runPhase('REVISER', 'REVISER', reviserPrompt, `${runtimePath}/08-revised.md`))) {
        throw new Error('REVISER phase failed');
      }
    } else {
      // Copy draft to revised
      await fs.copyFile(`${runtimePath}/05-draft.md`, `${runtimePath}/08-revised.md`);
      console.log(`${BLUE}[REVISER]${NC} ${YELLOW}...${NC} Skipped (audit passed)`);
    }
  } else {
    await fs.copyFile(`${runtimePath}/05-draft.md`, `${runtimePath}/08-revised.md`);
    console.log(`\n${BLUE}[AUDITOR/REVISER]${NC} ${YELLOW}...${NC} Skipped (--skip-audit)`);
  }

  // Phase 8: NORMALIZER
  console.log(`\n${YELLOW}═══ Phase 8: NORMALIZER ═══${NC}`);
  const normalizerPrompt = `Execute NORMALIZER phase.

Book ID: ${bookId}
Chapter: ${chapter}
Platform: ${platform}
Work directory: ${workDir}

Target word count (番茄):
- Ideal: 2800
- Acceptable range: 2520-3080
- Hard limit: 2240-3360

Read:
- ${runtimePath}/08-revised.md

DO NOT cut climax/resolution/must-keep scenes.

Output: Write to ${runtimePath}/09-normalized.md`;

  if (!(await runPhase('NORMALIZER', 'NORMALIZER', normalizerPrompt, `${runtimePath}/09-normalized.md`))) {
    throw new Error('NORMALIZER phase failed');
  }

  // Phase 9: EDITOR
  console.log(`\n${YELLOW}═══ Phase 9: EDITOR ═══${NC}`);
  const booksExt = platform === 'tangfan' ? 'txt' : 'md';
  const editorPrompt = `Execute EDITOR phase.

Book ID: ${bookId}
Chapter: ${chapter}
Platform: ${platform}
Work directory: ${workDir}

番茄小说 format:
- Chapter title: 第${chapter}章 {title}
- Paragraph separator: empty line
- Chapter hook: 6 spaces at end
- Output extension: ${booksExt}

Read:
- ${runtimePath}/09-normalized.md

Output:
- Write to ${runtimePath}/10-final.md
- Write to ${booksPath}/ch-${String(chapter).padStart(3, '0')}.${booksExt}`;

  if (!(await runPhase('EDITOR', 'EDITOR', editorPrompt, `${booksPath}/ch-${String(chapter).padStart(3, '0')}.${booksExt}`))) {
    throw new Error('EDITOR phase failed');
  }

  // Phase 10: FACTS-KEEPER
  console.log(`\n${YELLOW}═══ Phase 10: FACTS-KEEPER ═══${NC}`);
  const factsPrompt = `Execute FACTS-KEEPER phase.

Book ID: ${bookId}
Chapter: ${chapter}
Work directory: ${workDir}

Read:
- ${runtimePath}/06-facts.json
- ${STATE_DIR(bookId)}/current_state.json
- ${STATE_DIR(bookId)}/particle_ledger.json
- ${STATE_DIR(bookId)}/pending_hooks.json
- ${STATE_DIR(bookId)}/chapter_summaries.json
- ${STATE_DIR(bookId)}/subplot_board.json
- ${STATE_DIR(bookId)}/emotional_arcs.json
- ${STATE_DIR(bookId)}/character_matrix.json

Update all 7 truth files atomically.
- Increment chapter number in current_state.json
- Append chapter summary to chapter_summaries.json
- Update other files based on facts extracted

Output: Update these files in ${STATE_DIR(bookId)}/:`;

  if (!(await runPhase('FACTS-KEEPER', 'FACTS-KEEPER', factsPrompt, undefined))) {
    throw new Error('FACTS-KEEPER phase failed');
  }

  // Update chapter number in current_state.json
  const stateFile = `${STATE_DIR(bookId)}/current_state.json`;
  const state = await readJson(stateFile);
  state.chapter = chapter;
  state.lastUpdated = new Date().toISOString();
  await fs.writeFile(stateFile, JSON.stringify(state, null, 2));

  // Append to chapter_summaries
  const summariesFile = `${STATE_DIR(bookId)}/chapter_summaries.json`;
  const summaries = await readJson(summariesFile);
  const draftContent = await fs.readFile(`${runtimePath}/05-draft.md`, 'utf-8');
  const wordCount = draftContent.length;
  summaries.chapters = summaries.chapters || [];
  summaries.chapters.push({
    chapter,
    title: `第${chapter}章`,
    wordCount,
    summary: '',
    createdAt: new Date().toISOString()
  });
  summaries.lastUpdated = new Date().toISOString();
  await fs.writeFile(summariesFile, JSON.stringify(summaries, null, 2));

  console.log(`\n${GREEN}✓ Chapter ${chapter} completed!${NC}\n`);
  console.log(`Output: books/${bookId}/chapters/ch-${String(chapter).padStart(3, '0')}.${booksExt}`);
  console.log(`Runtime: ${runtimePath}/\n`);
}

// CLI Entry Point
async function main() {
  const args = process.argv.slice(2);

  let bookId = '';
  let chapterNumber: number | undefined;
  let context = '';
  let skipAudit = false;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--chapter':
        chapterNumber = parseInt(args[++i], 10);
        break;
      case '--context':
        context = args[++i];
        break;
      case '--skip-audit':
        skipAudit = true;
        break;
      case '--force':
        force = true;
        break;
      default:
        bookId = args[i];
    }
  }

  if (!bookId) {
    console.error('Usage: ts-node src/orchestrator.ts <book-id> [--chapter <n>] [--context "<text>"] [--skip-audit] [--force]');
    process.exit(1);
  }

  try {
    await runPipeline({
      bookId,
      chapterNumber,
      context,
      skipAudit,
      force
    });
  } catch (error) {
    console.error(`\n${RED}✗ Pipeline failed:${NC} ${error.message}`);
    process.exit(1);
  }
}

main();
