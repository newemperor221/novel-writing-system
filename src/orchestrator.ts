#!/usr/bin/env node
/**
 * Pipeline Orchestrator - Event-Driven Version
 *
 * Now uses WorkflowEngine with EventBus for agent communication.
 * Supports parallel execution and flexible workflow modes.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { createWorkflowEngine, WorkflowEngine } from './engine/WorkflowEngine.js';
import { WorkflowMode } from './events/EventTypes.js';

const WORKFLOW_DIR = process.cwd();

// Colors
const RED = '\x1b[0;31m';
const GREEN = '\x1b[0;32m';
const YELLOW = '\x1b[1;33m';
const BLUE = '\x1b[0;34m';
const NC = '\x1b[0m';

interface PipelineOptions {
  bookId: string;
  chapterNumber?: number;
  context?: string;
  skipAudit?: boolean;
  force?: boolean;
  platform?: string;
  mode?: WorkflowMode;
}

async function log(step: string, status: string, message: string) {
  console.log(`${BLUE}[${step}]${NC} ${status === '✓' ? GREEN : status === '✗' ? RED : YELLOW}${status}${NC} ${message}`);
}

async function getNextChapter(bookId: string): Promise<number> {
  const stateFile = path.join(WORKFLOW_DIR, 'state', bookId, 'current_state.json');
  try {
    const content = await fs.readFile(stateFile, 'utf-8');
    const state = JSON.parse(content);
    return (state.chapter || 0) + 1;
  } catch {
    return 1;
  }
}

async function getPlatform(bookId: string): Promise<string> {
  const intentFile = path.join(WORKFLOW_DIR, 'state', bookId, 'author_intent.json');
  try {
    const content = await fs.readFile(intentFile, 'utf-8');
    const intent = JSON.parse(content);
    return intent.targetPlatform || 'tangfan';
  } catch {
    return 'tangfan';
  }
}

async function runPipeline(options: PipelineOptions) {
  const { bookId, chapterNumber, context, skipAudit, force, mode, platform: platformOverride } = options;

  console.log(`${BLUE}╔══════════════════════════════════════════════════════╗${NC}`);
  console.log(`${BLUE}║         Event-Driven Multi-Agent Pipeline            ║${NC}`);
  console.log(`${BLUE}╚══════════════════════════════════════════════════════╝${NC}\n`);

  // Determine chapter number
  const chapter = chapterNumber || await getNextChapter(bookId);
  const platform = platformOverride || await getPlatform(bookId);
  const booksPath = path.join(WORKFLOW_DIR, 'books', bookId, 'chapters');

  console.log(`${GREEN}Book:${NC}     ${bookId}`);
  console.log(`${GREEN}Chapter:${NC}  ${chapter}`);
  console.log(`${GREEN}Platform:${NC} ${platform}`);
  console.log(`${GREEN}Mode:${NC}     ${mode || WorkflowMode.FULL}\n`);

  // Check if chapter exists (unless --force)
  const chapterFile = path.join(booksPath, `ch-${String(chapter).padStart(3, '0')}.md`);
  if (!force) {
    try {
      await fs.access(chapterFile);
      console.log(`${RED}Error: Chapter ${chapter} already exists. Use --force to overwrite.${NC}`);
      return;
    } catch {
      // File doesn't exist, which is what we want
    }
  }

  // Create engine and run workflow
  const engine = createWorkflowEngine({ workDir: WORKFLOW_DIR });

  const workflowMode = skipAudit ? WorkflowMode.FAST : (mode || WorkflowMode.FULL);

  try {
    await log('ENGINE', '...', `Starting workflow in ${workflowMode} mode`);

    const result = await engine.startWorkflow(bookId, chapter, workflowMode, {
      platform,
      userContext: context,
      force,
    });

    if (result.success) {
      await log('ENGINE', '✓', `Chapter ${chapter} completed in ${result.duration}ms`);
      console.log(`\n${GREEN}✓ Chapter ${chapter} completed!${NC}\n`);
      console.log(`Output: ${result.outputFile}`);
      console.log(`Phases: ${result.phasesCompleted.join(' → ')}`);
      if (result.totalCostUsd !== undefined && result.totalCostUsd > 0) {
        console.log(`Tokens: ${result.totalInputTokens?.toLocaleString()} in / ${result.totalOutputTokens?.toLocaleString()} out`);
        console.log(`Cost: $${result.totalCostUsd.toFixed(4)}\n`);
      }
    } else {
      await log('ENGINE', '✗', `Failed: ${result.error}`);
      console.log(`\n${RED}✗ Chapter ${chapter} failed${NC}\n`);
      if (result.error) {
        console.log(`Error: ${result.error}\n`);
      }
      console.log(`Completed phases: ${result.phasesCompleted.join(' → ')}\n`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    await log('ENGINE', '✗', `Exception: ${message}`);
    throw error;
  }
}

// CLI Entry Point
async function main() {
  const args = process.argv.slice(2);

  // Handle special commands first
  if (args[0] === '--cost') {
    const costLog = process.env.HOME + '/.inkos/cost_log.json';
    const { promises: fs } = await import('fs');
    try {
      const content = await fs.readFile(costLog, 'utf-8');
      const entries = JSON.parse(content);
      const total = entries.reduce((sum: number, e: any) => sum + (parseFloat(e.cost_usd) || 0), 0);
      const count = entries.length;
      console.log(`Total cost: $${total.toFixed(4)} across ${count} API calls`);
      if (args[1] === '--book' && args[2]) {
        const bookEntries = entries.filter((e: any) => e.book_id === args[2]);
        const bookTotal = bookEntries.reduce((sum: number, e: any) => sum + (parseFloat(e.cost_usd) || 0), 0);
        console.log(`Book ${args[2]}: $${bookTotal.toFixed(4)} across ${bookEntries.length} calls`);
      }
    } catch {
      console.log('No cost data found. Run some chapters first.');
    }
    return;
  }

  let bookId = '';
  let chapterNumber: number | undefined;
  let context = '';
  let skipAudit = false;
  let platform = '';
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
      case '--no-audit':
        skipAudit = true;
        break;
      case '--platform':
        platform = args[++i];
        break;
      case '--force':
        force = true;
        break;
      default:
        bookId = args[i];
    }
  }

  if (!bookId) {
    console.error('Usage: ts-node src/orchestrator.ts <book-id> [--chapter <n>] [--context "<text>"] [--skip-audit|--no-audit] [--platform <plat>] [--force]');
    console.error('       ts-node src/orchestrator.ts --cost [--book <book-id>]');
    process.exit(1);
  }

  try {
    await runPipeline({
      bookId,
      chapterNumber,
      context,
      skipAudit,
      force,
      platform,
    });
  } catch (error) {
    console.error(`\n${RED}✗ Pipeline failed:${NC} ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }
}

main();
