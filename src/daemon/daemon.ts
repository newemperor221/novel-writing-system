/**
 * Daemon - Background writing loop with webhook notifications.
 */

import { PipelineOrchestrator, PipelineResult } from '../tasks/pipeline-orchestrator.js'
import { WebhookPayload } from '../types/agents.js'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

interface DaemonState {
  daemonId: string
  bookId: string
  startedAt: string
  lastRunAt: string
  lastChapterCompleted: number
  totalChaptersCompleted: number
  consecutiveSuccesses: number
  status: 'running' | 'paused' | 'stopped'
  pauseReason: string | null
}

export class NovelWritingDaemon {
  private workDir: string
  private bookId: string
  private maxChapters: number
  private intervalSeconds: number
  private webhookUrl: string | null
  private state: DaemonState

  constructor(
    workDir: string,
    bookId: string,
    options: {
      maxChapters?: number
      intervalSeconds?: number
      webhookUrl?: string
    } = {}
  ) {
    this.workDir = workDir
    this.bookId = bookId
    this.maxChapters = options.maxChapters ?? Infinity
    this.intervalSeconds = options.intervalSeconds ?? 30
    this.webhookUrl = options.webhookUrl ?? null

    this.state = this.loadState()
  }

  private loadState(): DaemonState {
    const stateFile = join(this.workDir, 'runtime', this.bookId, '.daemon-state.json')
    try {
      if (existsSync(stateFile)) {
        const content = readFile(stateFile, 'utf-8')
        return JSON.parse(content)
      }
    } catch {
      // Ignore
    }

    return {
      daemonId: crypto.randomUUID(),
      bookId: this.bookId,
      startedAt: new Date().toISOString(),
      lastRunAt: new Date().toISOString(),
      lastChapterCompleted: 0,
      totalChaptersCompleted: 0,
      consecutiveSuccesses: 0,
      status: 'running',
      pauseReason: null,
    }
  }

  private async saveState(): Promise<void> {
    const stateFile = join(this.workDir, 'runtime', this.bookId, '.daemon-state.json')
    await mkdir(join(this.workDir, 'runtime', this.bookId), { recursive: true })
    await writeFile(stateFile, JSON.stringify(this.state, null, 2), 'utf-8')
  }

  async start(): Promise<void> {
    console.log(`Daemon starting for book ${this.bookId}`)
    this.state.status = 'running'
    await this.saveState()

    while (this.state.status === 'running') {
      if (this.state.totalChaptersCompleted >= this.maxChapters) {
        await this.stop('max_chapters_reached')
        break
      }

      try {
        await this.writeNextChapter()
      } catch (error) {
        console.error('Chapter write failed:', error)
        this.state.consecutiveSuccesses = 0

        const errorStr = String(error)
        if (errorStr.includes('CRITICAL')) {
          this.state.status = 'paused'
          this.state.pauseReason = 'critical_issue_detected'
          await this.saveState()

          await this.sendWebhook({
            event: 'critical_issue',
            timestamp: new Date().toISOString(),
            bookId: this.bookId,
            chapter: this.state.lastChapterCompleted + 1,
            criticalIssues: [],
          })
          break
        }
      }

      // Wait interval before next chapter
      await this.sleep(this.intervalSeconds * 1000)
    }
  }

  async stop(reason: string): Promise<void> {
    console.log(`Daemon stopping: ${reason}`)
    this.state.status = 'stopped'
    this.state.pauseReason = reason
    await this.saveState()

    await this.sendWebhook({
      event: 'daemon_stopped',
      timestamp: new Date().toISOString(),
      bookId: this.bookId,
      chapter: this.state.lastChapterCompleted,
    })
  }

  async resume(): Promise<void> {
    if (this.state.status !== 'paused') {
      throw new Error('Daemon is not paused')
    }
    console.log('Daemon resuming')
    this.state.status = 'running'
    this.state.pauseReason = null
    await this.saveState()
    await this.start()
  }

  private async writeNextChapter(): Promise<void> {
    const nextChapter = this.state.lastChapterCompleted + 1
    const startTime = Date.now()

    const orchestrator = new PipelineOrchestrator(this.workDir, this.bookId, nextChapter)
    const result: PipelineResult = await orchestrator.execute()

    const executionTime = (Date.now() - startTime) / 1000

    if (result.success) {
      this.state.lastChapterCompleted = nextChapter
      this.state.totalChaptersCompleted++
      this.state.consecutiveSuccesses++
      this.state.lastRunAt = new Date().toISOString()
      await this.saveState()

      await this.sendWebhook({
        event: 'chapter_completed',
        timestamp: new Date().toISOString(),
        bookId: this.bookId,
        chapter: nextChapter,
        wordCount: 0, // Would read from file
        auditResult: 'PASS',
        executionTimeSeconds: executionTime,
      })
    } else {
      throw new Error('Pipeline execution failed')
    }
  }

  private async sendWebhook(payload: WebhookPayload): Promise<void> {
    if (!this.webhookUrl) return

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'NovelWritingDaemon/1.0',
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        console.error(`Webhook failed: HTTP ${response.status}`)
      }
    } catch (error) {
      console.error('Webhook failed:', error)
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  getState(): DaemonState {
    return { ...this.state }
  }
}

// Webhook utility
export async function sendWebhook(
  url: string,
  payload: WebhookPayload
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'NovelWritingDaemon/1.0',
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      }
    }

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
