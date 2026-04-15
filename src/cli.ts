/**
 * CLI Entry Point
 * Novel Writing Workflow - Native Claude Code Multi-Agent Architecture
 */

import { PipelineOrchestrator } from './tasks/pipeline-orchestrator.js'
import { NovelWritingDaemon } from './daemon/daemon.js'
import { RadarAgent } from './agents/radar-agent.js'

interface Args {
  command: string
  bookId?: string
  chapter?: number
  maxChapters?: number
  interval?: number
  webhook?: string
}

function parseArgs(argv: string[]): Args {
  const args: Args = { command: argv[0] || 'help' }

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case '--book-id':
      case '-b':
        args.bookId = argv[++i]
        break
      case '--chapter':
      case '-c':
        args.chapter = parseInt(argv[++i])
        break
      case '--max-chapters':
      case '-m':
        args.maxChapters = parseInt(argv[++i])
        break
      case '--interval':
      case '-i':
        args.interval = parseInt(argv[++i])
        break
      case '--webhook':
      case '-w':
        args.webhook = argv[++i]
        break
      case 'help':
      case '--help':
      case '-h':
        args.command = 'help'
        break
    }
  }

  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const workDir = process.cwd()

  switch (args.command) {
    case 'write-chapter': {
      if (!args.bookId) {
        console.error('Error: --book-id is required')
        process.exit(1)
      }

      console.log(`Writing chapter for book: ${args.bookId}, chapter: ${args.chapter ?? 'next'}`)

      const orchestrator = new PipelineOrchestrator(workDir, args.bookId, args.chapter)
      const result = await orchestrator.execute()

      if (result.success) {
        console.log(`Chapter written to: ${result.chapterFile}`)
        console.log(`Execution time: ${result.executionTimeSeconds.toFixed(1)}s`)
        if (result.issues && result.issues.length > 0) {
          console.log(`Issues: ${result.issues.length}`)
        }
      } else {
        console.error('Chapter writing failed')
        if (result.issues) {
          console.error('Issues:', JSON.stringify(result.issues, null, 2))
        }
        process.exit(1)
      }
      break
    }

    case 'daemon': {
      if (!args.bookId) {
        console.error('Error: --book-id is required')
        process.exit(1)
      }

      console.log(`Starting daemon for book: ${args.bookId}`)

      const daemon = new NovelWritingDaemon(workDir, args.bookId, {
        maxChapters: args.maxChapters,
        intervalSeconds: args.interval,
        webhookUrl: args.webhook,
      })

      await daemon.start()
      break
    }

    case 'radar': {
      if (!args.bookId) {
        console.error('Error: --book-id is required')
        process.exit(1)
      }

      console.log(`Running market analysis for book: ${args.bookId}`)

      const radar = new RadarAgent(workDir)
      const report = await radar.execute(args.bookId)

      console.log('\n=== Market Analysis Report ===')
      console.log('\nHot Tropes:')
      report.hotTropes.forEach(t => console.log(`  - ${t}`))
      console.log('\nDeclining Tropes:')
      report.decliningTropes.forEach(t => console.log(`  - ${t}`))
      console.log('\nRecommendations:')
      report.recommendations.forEach(r => {
        console.log(`  [${r.risk}] ${r.what} - ${r.why}`)
      })
      break
    }

    case 'help':
    default:
      console.log(`
Novel Writing Workflow CLI

Usage:
  npx ts-node src/cli.ts <command> [options]

Commands:
  write-chapter    Write next or specified chapter
  daemon           Start background writing daemon
  radar            Run market trend analysis

Options:
  --book-id, -b    Book ID (required for most commands)
  --chapter, -c    Chapter number (optional, auto-detects next)
  --max-chapters   Maximum chapters for daemon (default: unlimited)
  --interval, -i   Interval between chapters in seconds (default: 30)
  --webhook, -w    Webhook URL for notifications

Examples:
  # Write next chapter
  npx ts-node src/cli.ts write-chapter --book-id my-book

  # Write specific chapter
  npx ts-node src/cli.ts write-chapter --book-id my-book --chapter 5

  # Start daemon
  npx ts-node src/cli.ts daemon --book-id my-book --max-chapters 10 --webhook https://...

  # Run market analysis
  npx ts-node src/cli.ts radar --book-id my-book
`)
      break
  }
}

main().catch(error => {
  console.error('Error:', error)
  process.exit(1)
})
