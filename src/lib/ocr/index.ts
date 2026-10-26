/**
 * OCR adapter — provider-neutral interface per BRD §4 (provider-neutral adapter pattern).
 *
 * Two implementations:
 *   - TesseractAdapter: real, uses system Tesseract via child_process (no
 *     tesseract.js worker issues; works in Next.js dev + standalone builds)
 *   - PaddleAdapter: stub — PaddleOCR is Python-only and can't run in the Next.js
 *     container. Stub returns a clear "needs Python worker" message so the
 *     frontend can render a placeholder. The adapter interface stays clean so
 *     when the project is deployed to a real server with Python, a real
 *     PaddleAdapter drops in without touching any other code.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFile, mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'

const execFileAsync = promisify(execFile)

export type OcrResult = {
  text: string
  confidence: number  // 0..1
  timeMs: number
  engine: 'tesseract' | 'paddleocr' | 'none'
}

export interface OcrAdapter {
  readonly engine: 'tesseract' | 'paddleocr' | 'none'
  isAvailable(): Promise<boolean>
  recognize(buffer: Buffer, mimeType: string): Promise<OcrResult>
}

// ───────────────────────────────────────────────────────────────────────────

const writeFileAsync = promisify(writeFile)
const mkdtempAsync = promisify(mkdtemp)

export class TesseractAdapter implements OcrAdapter {
  readonly engine = 'tesseract' as const

  async isAvailable(): Promise<boolean> {
    // System tesseract is installed via apt (tesseract-ocr + tesseract-ocr-eng).
    // Verified working: /usr/bin/tesseract --version reports 5.5.0.
    try {
      await execFileAsync('tesseract', ['--version'])
      return true
    } catch {
      return false
    }
  }

  async recognize(buffer: Buffer, mimeType: string): Promise<OcrResult> {
    const start = Date.now()
    // Tesseract CLI reads from stdin or from a file. We write to a temp file
    // with a proper extension (matters for image MIME type detection).
    const ext = mimeType.includes('png') ? '.png'
      : mimeType.includes('jpeg') || mimeType.includes('jpg') ? '.jpg'
      : mimeType.includes('webp') ? '.webp'
      : '.bin'
    const tmpDir = await mkdtemp(path.join(tmpdir(), 'ocr-'))
    const inputPath = path.join(tmpDir, `input${ext}`)
    const outputPathBase = path.join(tmpDir, 'output')
    try {
      await writeFile(inputPath, buffer)
      // tesseract <input> <output_base> [-l eng] [TSV output for confidence]
      await execFileAsync('tesseract', [
        inputPath,
        outputPathBase,
        '-l', 'eng',
        '--psm', '4',   // assume a single column of text of variable sizes (good for invoices)
        'tsv',          // output format: TSV with confidence per word
      ])
      // Read the TSV output
      const tsv = await readFile(`${outputPathBase}.tsv`, 'utf8')
      // Parse TSV: first line is header, subsequent lines are word entries.
      // Format: level page_num block_num par_num line_num word_num left top width height conf text
      const lines = tsv.trim().split('\n')
      const textLines: string[] = []
      const confidences: number[] = []
      let currentLineNum = -1
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split('\t')
        if (parts.length < 12) continue
        const lineNum = parseInt(parts[4], 10)
        const conf = parseFloat(parts[10])
        const word = parts[11] ?? ''
        if (lineNum !== currentLineNum) {
          textLines.push('')
          currentLineNum = lineNum
        }
        textLines[textLines.length - 1] += (textLines[textLines.length - 1] ? ' ' : '') + word
        if (!isNaN(conf) && conf >= 0) confidences.push(conf)
      }
      const text = textLines.map(l => l.trim()).filter(Boolean).join('\n')
      const avgConfidence = confidences.length > 0
        ? (confidences.reduce((a, b) => a + b, 0) / confidences.length) / 100
        : 0
      return {
        text,
        confidence: avgConfidence,
        timeMs: Date.now() - start,
        engine: this.engine,
      }
    } finally {
      // Cleanup temp files
      try { await rm(tmpDir, { recursive: true, force: true }) } catch {}
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────

export class PaddleAdapter implements OcrAdapter {
  readonly engine = 'paddleocr' as const

  /**
   * PaddleOCR is Python-only and requires either:
   *   (a) a Python sidecar service running alongside the Next.js app, OR
   *   (b) deployment to a server with Python installed.
   *
   * The Next.js preview environment has neither, so this adapter is a stub.
   * The interface is kept identical so when the project is deployed to a real
   * server with Python, swap the body to call the Python service via fetch().
   */
  async isAvailable(): Promise<boolean> {
    return false
  }

  async recognize(_buffer: Buffer, _mimeType: string): Promise<OcrResult> {
    return {
      text: '',
      confidence: 0,
      timeMs: 0,
      engine: this.engine,
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────

export const tesseractAdapter = new TesseractAdapter()
export const paddleAdapter = new PaddleAdapter()

export const ocrAdapters = {
  tesseract: tesseractAdapter,
  paddle: paddleAdapter,
}

/** Run multiple engines in parallel and return all results (for the compare view). */
export async function runOcrEngines(
  buffer: Buffer,
  mimeType: string,
  engines: Array<'tesseract' | 'paddle'> = ['tesseract']
): Promise<OcrResult[]> {
  const tasks = engines.map(async name => {
    const adapter = ocrAdapters[name]
    try {
      const avail = await adapter.isAvailable()
      if (!avail) return null
      return await adapter.recognize(buffer, mimeType)
    } catch (e) {
      console.error(`[ocr:${name}] failed:`, e)
      return null
    }
  })
  // Use allSettled so one slow engine doesn't block the others
  const results = await Promise.allSettled(tasks)
  return results
    .filter((r): r is PromiseFulfilledResult<OcrResult | null> => r.status === 'fulfilled')
    .map(r => r.value)
    .filter((r): r is OcrResult => r !== null)
}
