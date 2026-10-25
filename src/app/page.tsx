'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sparkles, FileText, Settings, History, Download } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

import { UploadPanel } from '@/components/extraction/upload-panel'
import { ExtractionResult, type ExtractionResponse } from '@/components/extraction/result-panel'
import { TemplateEditor } from '@/components/extraction/template-editor'
import { JobHistory } from '@/components/extraction/job-history'
import { EngineCompare } from '@/components/extraction/engine-compare'
import { AnalyseSampleButton } from '@/components/extraction/analyse-sample-button'
import type { TemplateDef, FieldDef } from '@/lib/templates/schema'

export default function Home() {
  const { toast } = useToast()
  const [tab, setTab] = useState('extract')
  const [templates, setTemplates] = useState<TemplateDef[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateDef | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [result, setResult] = useState<ExtractionResponse | null>(null)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [refreshSignal, setRefreshSignal] = useState(0)

  // Load templates
  useEffect(() => {
    fetch('/api/templates')
      .then(r => r.json())
      .then(d => {
        const list: TemplateDef[] = d.templates ?? []
        setTemplates(list)
        if (list.length > 0 && selectedTemplateId == null) {
          setSelectedTemplateId(list[0].id)
          setSelectedTemplate(list[0])
        }
      })
      .catch(e => toast({ title: 'Failed to load templates', description: String(e), variant: 'destructive' }))
  }, [toast, selectedTemplateId])

  // If no templates exist, seed the starter invoice template
  useEffect(() => {
    if (templates.length === 0) {
      fetch('/api/templates', { method: 'PUT' })
        .then(() => fetch('/api/templates'))
        .then(r => r.json())
        .then(d => {
          const list: TemplateDef[] = d.templates ?? []
          setTemplates(list)
          if (list.length > 0) {
            setSelectedTemplateId(list[0].id)
            setSelectedTemplate(list[0])
          }
        })
        .catch(e => toast({ title: 'Failed to seed starter template', description: String(e), variant: 'destructive' }))
    }
  }, [templates.length, toast])

  const handleFileSelected = useCallback(async (file: File) => {
    if (!selectedTemplateId) {
      toast({ title: 'No template selected', description: 'Pick or create a template first.', variant: 'destructive' })
      return
    }
    setIsProcessing(true)
    setResult(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('templateId', selectedTemplateId)
      // Multi-invoice mode: 'auto' by default — backend will detect bundled invoices
      formData.append('multiInvoice', 'auto')
      const res = await fetch('/api/extract', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data?.error?.message ?? `HTTP ${res.status}`)
      }
      setResult(data as ExtractionResponse)
      setSelectedJobId(data.job_id)
      setRefreshSignal(s => s + 1)
      toast({
        title: data.status === 'completed' ? 'Extraction complete' : 'Extraction has warnings',
        description: data.multi_invoice
          ? `${file.name} → ${data.template.name} (${data.document_count} invoices detected)`
          : `${file.name} → ${data.template.name}`,
      })
    } catch (e) {
      toast({ title: 'Extraction failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' })
    } finally {
      setIsProcessing(false)
    }
  }, [selectedTemplateId, toast])

  const handleSelectJob = useCallback(async (jobId: string) => {
    setSelectedJobId(jobId)
    try {
      const res = await fetch(`/api/jobs/${jobId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`)

      // The DB stores multi-invoice jobs as `{ documents: [...] }` and single-invoice
      // jobs as the document data directly. Normalize to ExtractionResponse shape.
      const extracted = data.extracted_data ?? {}
      const validation = data.validation ?? { is_valid: false, missing_fields: [], issues: [] }
      const isMultiStored = validation.multi_invoice === true || (extracted && Array.isArray(extracted.documents))

      if (isMultiStored && extracted.documents) {
        setResult({
          job_id: data.id,
          status: data.status,
          template: { id: data.template.id, name: data.template.name },
          multi_invoice: true,
          document_count: extracted.documents.length,
          documents: extracted.documents.map((d: {
            marker: string
            data: Record<string, unknown>
            validation?: typeof validation
          }) => ({
            marker: d.marker,
            data: d.data,
            // Use per-doc validation if stored, fall back to aggregate
            validation: d.validation ?? validation,
          })),
          diagnostics: data.diagnostics ?? {},
          raw_ocr_text: data.raw_ocr_text ?? '',
          raw_llm_response: data.raw_llm_response ?? '',
        })
      } else {
        setResult({
          job_id: data.id,
          status: data.status,
          template: { id: data.template.id, name: data.template.name },
          multi_invoice: false,
          data: extracted,
          validation,
          diagnostics: data.diagnostics ?? {},
          raw_ocr_text: data.raw_ocr_text ?? '',
          raw_llm_response: data.raw_llm_response ?? '',
        })
      }
      setTab('extract')
    } catch (e) {
      toast({ title: 'Failed to load job', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' })
    }
  }, [toast])

  const handleTemplateSaved = useCallback((t: TemplateDef) => {
    setSelectedTemplate(t)
    setTemplates(ts => ts.map(x => x.id === t.id ? t : x))
    toast({ title: 'Template updated', description: t.name })
  }, [toast])

  /**
   * Handle "Analyse sample → suggest fields" → "Create new template" flow.
   * Per BRD §3 US-03: System proposes fields with types and sample values;
   * user can edit all suggestions. POSTs to /api/templates to create new.
   */
  const handleNewTemplateCreated = useCallback(async (
    templateName: string, fields: FieldDef[], instructions: string
  ) => {
    const res = await fetch('/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: templateName,
        documentType: 'invoice',
        fields,
        instructions,
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err?.error?.message ?? `HTTP ${res.status}`)
    }
    const created = await res.json()
    // Refresh templates list and select the new one
    const listRes = await fetch('/api/templates')
    const listData = await listRes.json()
    const list: TemplateDef[] = listData.templates ?? []
    setTemplates(list)
    const newTpl = list.find(t => t.id === created.id)
    if (newTpl) {
      setSelectedTemplateId(newTpl.id)
      setSelectedTemplate(newTpl)
    }
  }, [])

  const download = useCallback((format: 'json' | 'csv') => {
    if (!result?.job_id) return
    window.open(`/api/jobs/${result.job_id}/export?format=${format}`, '_blank')
  }, [result?.job_id])

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary p-2">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight">AI Document Extraction Platform</h1>
              <p className="text-xs text-muted-foreground">
                Upload · OCR · LLM extraction · Schema-validated JSON · CSV/JSON export
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">v0.1 MVP</Badge>
            <Badge variant="secondary" className="text-xs">Z.ai LLM</Badge>
            <Badge variant="secondary" className="text-xs">Tesseract 5</Badge>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-6xl mx-auto px-4 py-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid grid-cols-3 w-full max-w-md mb-6">
            <TabsTrigger value="extract" className="gap-1.5">
              <FileText className="h-4 w-4" /> Extract
            </TabsTrigger>
            <TabsTrigger value="templates" className="gap-1.5">
              <Settings className="h-4 w-4" /> Template
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-1.5">
              <History className="h-4 w-4" /> History
            </TabsTrigger>
          </TabsList>

          {/* ────── Extract tab ────── */}
          <TabsContent value="extract" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Step 1 — Choose template and upload a document</CardTitle>
                <CardDescription>
                  Pick a template, then drop a PDF, PNG, or JPG. The pipeline will
                  parse (or OCR), call the LLM with the template's schema, and
                  validate the result.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-end gap-3">
                  <div className="space-y-1.5 flex-1 max-w-sm">
                    <label className="text-xs text-muted-foreground">Template</label>
                    <Select
                      value={selectedTemplateId ?? ''}
                      onValueChange={(v) => {
                        setSelectedTemplateId(v)
                        const t = templates.find(t => t.id === v)
                        if (t) setSelectedTemplate(t)
                      }}
                    >
                      <SelectTrigger><SelectValue placeholder="Select template" /></SelectTrigger>
                      <SelectContent>
                        {templates.map(t => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="text-xs text-muted-foreground pb-2">
                    {selectedTemplate ? `${selectedTemplate.fields.length} fields` : '—'}
                  </div>
                </div>
                <UploadPanel onFileSelected={handleFileSelected} isProcessing={isProcessing} />
              </CardContent>
            </Card>

            {result && (
              <>
                <div className="flex items-center justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => download('json')}>
                    <Download className="h-3.5 w-3.5 mr-1" />Export JSON
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => download('csv')}>
                    <Download className="h-3.5 w-3.5 mr-1" />Export CSV
                  </Button>
                </div>
                <ExtractionResult result={result} />
                <EngineCompare
                  ocrEngine={result.diagnostics.ocr_engine}
                  ocrConfidence={result.diagnostics.ocr_confidence}
                  ocrTimeMs={result.diagnostics.ocr_time_ms}
                />
              </>
            )}
          </TabsContent>

          {/* ────── Template tab ────── */}
          <TabsContent value="templates" className="space-y-3">
            <div className="flex items-center justify-end">
              <AnalyseSampleButton onTemplateCreated={handleNewTemplateCreated} />
            </div>
            {selectedTemplate ? (
              <TemplateEditor template={selectedTemplate} onSaved={handleTemplateSaved} />
            ) : (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  No template loaded. The starter invoice template should appear shortly…
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ────── History tab ────── */}
          <TabsContent value="history">
            <JobHistory
              selectedJobId={selectedJobId}
              onSelectJob={handleSelectJob}
              refreshSignal={refreshSignal}
            />
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="border-t mt-12 py-6 text-center text-xs text-muted-foreground">
        <div className="max-w-6xl mx-auto px-4">
          Per BRD §4 — provider-neutral adapters for OCR and LLM. Swap engines
          without touching extraction code.
        </div>
      </footer>
    </div>
  )
}
