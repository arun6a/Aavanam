/**
 * LLM extraction adapter — provider-neutral per BRD §4.
 *
 * v1: uses Z.ai's built-in LLM via z-ai-web-dev-sdk (no API key needed —
 * comes with the Z.ai preview environment). At test time, swap to OpenAI
 * by changing one line: `createExtractor('openai', OPENAI_API_KEY)`.
 *
 * The LLM is given:
 *   1. The document text (from PDF parse or OCR)
 *   2. The template's instructions (free-text)
 *   3. The template's field definitions (name, type, description, sample)
 *   4. A JSON Schema describing the exact output shape
 *
 * It returns structured JSON that's then validated against the schema.
 */

import ZAI from 'z-ai-web-dev-sdk'
import type { TemplateDef } from '@/lib/templates/schema'
import { templateToJsonSchema } from '@/lib/templates/schema'

export type ExtractionResult = {
  data: Record<string, unknown>
  rawResponse: string
  model: string
  timeMs: number
  tokensIn: number  // estimated
  tokensOut: number  // estimated
}

export interface LlmAdapter {
  readonly provider: string
  extract(text: string, template: TemplateDef): Promise<ExtractionResult>
}

// ───────────────────────────────────────────────────────────────────────────

export class ZaiLlmAdapter implements LlmAdapter {
  readonly provider = 'zai'

  async extract(text: string, template: TemplateDef): Promise<ExtractionResult> {
    const start = Date.now()
    const zai = await ZAI.create()

    // Check if template has line_items — if yes AND it has many header fields,
    // split into 2 LLM calls to avoid hitting LLM context/output limits with
    // complex schemas (the Indian GST template has 26 fields + 11 sub-fields).
    const lineItemsField = template.fields.find(f => f.type === 'line_items')
    const headerFields = template.fields.filter(f => f.type !== 'line_items')

    if (lineItemsField && headerFields.length > 15) {
      // Split extraction: 2 LLM calls in parallel
      console.log('[zai] splitting extraction into header + line_items')
      const headerTemplate: TemplateDef = {
        ...template,
        fields: headerFields,
      }
      const lineItemsTemplate: TemplateDef = {
        ...template,
        fields: [lineItemsField],
      }
      const [headerResult, lineResult] = await Promise.all([
        this.extractSingle(text, headerTemplate, zai),
        this.extractSingle(text, lineItemsTemplate, zai),
      ])
      const data = {
        ...headerResult.data,
        ...lineResult.data,
      }
      return {
        data,
        rawResponse: JSON.stringify({ header: headerResult.rawResponse, line_items: lineResult.rawResponse }),
        model: 'zai-glm-4',
        timeMs: Date.now() - start,
        tokensIn: headerResult.tokensIn + lineResult.tokensIn,
        tokensOut: headerResult.tokensOut + lineResult.tokensOut,
      }
    }

    // Single-call extraction (small templates)
    return this.extractSingle(text, template, zai)
  }

  private async extractSingle(text: string, template: TemplateDef, zai: Awaited<ReturnType<typeof ZAI.create>>): Promise<ExtractionResult> {
    const startLocal = Date.now()
    const schema = templateToJsonSchema(template)
    const fieldList = template.fields.map(f =>
      `- ${f.name} (${f.type}${f.required ? ', required' : ', optional'}): ${f.description ?? '(no description)'}${f.sample ? ` [e.g. ${f.sample}]` : ''}`
    ).join('\n')

    const systemPrompt = `You are a document extraction engine. Extract structured fields from the given document text according to the template below.

Template: ${template.name}
Instructions: ${template.instructions ?? '(none)'}
Fields to extract:
${fieldList}

Return ONLY valid JSON — no prose, no markdown fences, no commentary. The JSON must match this exact schema:

${JSON.stringify(schema, null, 2)}

Rules:
- Use null for any field not present in the document.
- For currency/number fields, return plain numbers (no $ or currency symbol).
- For date fields, return ISO 8601 (YYYY-MM-DD).
- For line_items, return an array of objects, one per line item in the document.
- Do NOT include any field that is not in the schema above.
- ALSO include a special key "_confidence" with values 0.0–1.0 for each extracted field indicating your confidence the value is correct.
  Format: { "_confidence": { "field_name": 0.95, ... } }
  Use 1.0 for fields clearly visible in the document, 0.7–0.9 for inferred or partially visible,
  0.0–0.3 for guesses, omit for null fields.
- For line_items confidence, use "_confidence.line_items[i].field_name" pattern: { "_confidence": { "line_items": [{ "description": 0.95, ... }, ...] } }`

    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Document text:\n\n${text}` },
      ],
      thinking: { type: 'disabled' },
    })

    const rawResponse = completion.choices[0]?.message?.content ?? ''
    const data = parseLlmJson(rawResponse)
    const tokensIn = Math.ceil((systemPrompt.length + text.length) / 4)
    const tokensOut = Math.ceil(rawResponse.length / 4)

    return {
      data,
      rawResponse,
      model: 'zai-glm-4',
      timeMs: Date.now() - startLocal,
      tokensIn,
      tokensOut,
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────

/**
 * OpenAI adapter — ready to drop in at test time.
 * Just needs `OPENAI_API_KEY` env var set, then `setActiveAdapter(new OpenAiLlmAdapter())`.
 */
export class OpenAiLlmAdapter implements LlmAdapter {
  readonly provider = 'openai'
  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async extract(text: string, template: TemplateDef): Promise<ExtractionResult> {
    const start = Date.now()
    const schema = templateToJsonSchema(template)
    const fieldList = template.fields.map(f =>
      `- ${f.name} (${f.type}${f.required ? ', required' : ', optional'}): ${f.description ?? '(no description)'}${f.sample ? ` [e.g. ${f.sample}]` : ''}`
    ).join('\n')

    const systemPrompt = `You are a document extraction engine. Extract structured fields from the given document text according to the template below.

Template: ${template.name}
Instructions: ${template.instructions ?? '(none)'}
Fields to extract:
${fieldList}

Return ONLY valid JSON matching this schema:
${JSON.stringify(schema, null, 2)}

Rules: Use null for missing fields. Numbers without currency symbols. Dates as YYYY-MM-DD.`

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Document text:\n\n${text}` },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
      }),
    })

    if (!response.ok) {
      throw new Error(`OpenAI API ${response.status}: ${await response.text()}`)
    }

    const json = await response.json()
    const rawResponse = json.choices[0]?.message?.content ?? ''
    const data = parseLlmJson(rawResponse)

    return {
      data,
      rawResponse,
      model: 'gpt-4o-mini',
      timeMs: Date.now() - start,
      tokensIn: json.usage?.prompt_tokens ?? 0,
      tokensOut: json.usage?.completion_tokens ?? 0,
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────

/**
 * Robust JSON extraction from LLM responses.
 * Handles:
 *   - Pure JSON response
 *   - JSON wrapped in ```json ... ``` markdown
 *   - JSON with leading/trailing prose (finds first { to last })
 */
export function parseLlmJson(raw: string): Record<string, unknown> {
  // Try direct parse first
  try {
    return JSON.parse(raw)
  } catch {
    // fall through
  }
  // Try unwrapping from markdown code fence
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim())
    } catch {
      // fall through
    }
  }
  // Try to extract the largest {...} block
  const first = raw.indexOf('{')
  const last = raw.lastIndexOf('}')
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(raw.slice(first, last + 1))
    } catch {
      // fall through
    }
  }
  return {}
}

// ───────────────────────────────────────────────────────────────────────────

let activeAdapter: LlmAdapter = new ZaiLlmAdapter()

export function getLlmAdapter(): LlmAdapter {
  return activeAdapter
}

export function setActiveAdapter(adapter: LlmAdapter): void {
  activeAdapter = adapter
}
