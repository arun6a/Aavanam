'use client'

import { CheckCircle2, AlertTriangle, XCircle, Clock, FileText } from 'lucide-react'
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { ValidationResult } from '@/lib/validation/validate'

export type Diagnostics = {
  ocr_engine: string | null
  ocr_confidence: number | null
  ocr_time_ms: number | null
  pdf_text_length: number | null
  pdf_time_ms: number | null
  multi_invoice_detected: boolean
  multi_invoice_split_ms: number
  llm_model: string | null
  llm_time_ms: number | null
  llm_tokens_in: number | null
  llm_tokens_out: number | null
  total_processing_ms: number | null
}

export type MultiDocument = {
  marker: string
  data: Record<string, unknown>
  validation: ValidationResult
}

export type ExtractionResponse = {
  job_id: string
  status: 'completed' | 'review_required' | 'failed'
  template: { id: string; name: string }
  multi_invoice: boolean
  document_count?: number
  documents?: MultiDocument[]
  data?: Record<string, unknown>
  validation?: ValidationResult
  diagnostics: Diagnostics
  raw_ocr_text: string
  raw_llm_response: string
}

type Props = {
  result: ExtractionResponse
}

export function ExtractionResult({ result }: Props) {
  const { diagnostics, status, raw_ocr_text } = result
  const isMulti = result.multi_invoice === true && Array.isArray(result.documents)

  return (
    <div className="space-y-4">
      {/* Status banner */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              {status === 'completed' && <CheckCircle2 className="h-6 w-6 text-emerald-600" />}
              {status === 'review_required' && <AlertTriangle className="h-6 w-6 text-amber-500" />}
              {status === 'failed' && <XCircle className="h-6 w-6 text-rose-600" />}
              <div>
                <CardTitle className="text-lg">
                  {status === 'completed' && 'Extraction complete'}
                  {status === 'review_required' && 'Extraction complete with warnings'}
                  {status === 'failed' && 'Extraction failed'}
                </CardTitle>
                <CardDescription>
                  Template: {result.template.name} · job {result.job_id.slice(0, 8)}
                  {isMulti && ` · ${result.document_count} invoices detected`}
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={status === 'completed' ? 'default' : 'secondary'}>
                {status}
              </Badge>
              {isMulti && (
                <Badge variant="outline" className="text-xs">
                  multi-invoice
                </Badge>
              )}
              {diagnostics.total_processing_ms != null && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {(diagnostics.total_processing_ms / 1000).toFixed(1)}s
                </span>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Multi-invoice: render each document separately */}
      {isMulti ? (
        <>
          <Card className="border-primary/40">
            <CardContent className="p-3">
              <div className="text-xs text-muted-foreground flex items-start gap-2">
                <FileText className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <div>
                  <strong className="text-foreground">Multi-invoice PDF detected.</strong>{' '}
                  The uploaded document contains {result.documents!.length} bundled invoices
                  (common in Indian GST annexure-style tax invoices). Each invoice was split
                  and extracted separately below.
                  {diagnostics.multi_invoice_split_ms != null && diagnostics.multi_invoice_split_ms > 0 && (
                    <> Split time: {(diagnostics.multi_invoice_split_ms / 1000).toFixed(1)}s.</>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
          {result.documents!.map((doc, idx) => (
            <DocumentBlock key={idx} doc={doc} index={idx} />
          ))}
        </>
      ) : (
        <>
          {/* Single-doc validation issues */}
          {result.validation && result.validation.issues.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Validation issues
                  <Badge variant="outline">{result.validation.issues.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {result.validation.issues.map((issue, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <Badge variant="outline" className="text-xs font-mono">
                      {issue.type}
                    </Badge>
                    <span className="text-muted-foreground">{issue.field}:</span>
                    <span>{issue.message}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Extracted data */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Extracted data</CardTitle>
              <CardDescription>
                Structured JSON from the LLM, validated against the template schema
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="max-h-96 rounded-md border bg-muted/30">
                <pre className="p-4 text-xs font-mono whitespace-pre-wrap">
                  {JSON.stringify(result.data ?? {}, null, 2)}
                </pre>
              </ScrollArea>
            </CardContent>
          </Card>
        </>
      )}

      {/* Diagnostics grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <DiagCard label="OCR engine" value={diagnostics.ocr_engine ?? '—'} icon={<FileText className="h-3.5 w-3.5" />} />
        <DiagCard
          label="OCR confidence"
          value={diagnostics.ocr_confidence != null
            ? `${(diagnostics.ocr_confidence * 100).toFixed(0)}%`
            : '—'}
          icon={<FileText className="h-3.5 w-3.5" />}
        />
        <DiagCard
          label="LLM model"
          value={diagnostics.llm_model ?? '—'}
          icon={<FileText className="h-3.5 w-3.5" />}
        />
        <DiagCard
          label="Total time"
          value={diagnostics.total_processing_ms != null
            ? `${(diagnostics.total_processing_ms / 1000).toFixed(1)}s`
            : '—'}
          icon={<Clock className="h-3.5 w-3.5" />}
        />
      </div>

      {/* Raw OCR text — collapsible */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Raw OCR text</CardTitle>
          <CardDescription>What the OCR engine actually saw (combined for all invoices in the PDF)</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="max-h-80 rounded-md border bg-muted/30">
            <pre className={cn('p-4 text-xs font-mono whitespace-pre-wrap', !raw_ocr_text && 'text-muted-foreground italic')}>
              {raw_ocr_text || '(no text extracted)'}
            </pre>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  )
}

function DocumentBlock({ doc, index }: { doc: MultiDocument; index: number }) {
  return (
    <Card className="border-l-4 border-l-primary">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Badge variant="outline">#{index + 1}</Badge>
              {doc.marker}
            </CardTitle>
            <CardDescription>
              {doc.validation.is_valid
                ? 'Valid extraction'
                : `${doc.validation.issues.length} validation issue${doc.validation.issues.length === 1 ? '' : 's'}`}
            </CardDescription>
          </div>
          <Badge variant={doc.validation.is_valid ? 'default' : 'secondary'}>
            {doc.validation.is_valid ? 'valid' : 'review'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {doc.validation.issues.length > 0 && (
          <div className="space-y-1 text-xs">
            {doc.validation.issues.slice(0, 5).map((issue, i) => (
              <div key={i} className="flex items-start gap-2">
                <Badge variant="outline" className="text-xs font-mono">{issue.type}</Badge>
                <span className="text-muted-foreground">{issue.field}:</span>
                <span>{issue.message}</span>
              </div>
            ))}
            {doc.validation.issues.length > 5 && (
              <div className="text-xs text-muted-foreground">+{doc.validation.issues.length - 5} more…</div>
            )}
          </div>
        )}
        <ScrollArea className="max-h-80 rounded-md border bg-muted/30">
          <pre className="p-3 text-xs font-mono whitespace-pre-wrap">
            {JSON.stringify(doc.data, null, 2)}
          </pre>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

function DiagCard({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">{icon}{label}</div>
        <div className="font-semibold text-sm mt-1 truncate">{value}</div>
      </CardContent>
    </Card>
  )
}
