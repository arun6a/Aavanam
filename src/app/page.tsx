'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession, signOut, signIn } from 'next-auth/react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sparkles, FileText, Settings, History, Download, LayoutDashboard, LogOut, User } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

import { UploadPanel } from '@/components/extraction/upload-panel'
import { ExtractionResult, type ExtractionResponse } from '@/components/extraction/result-panel'
import { TemplateEditor } from '@/components/extraction/template-editor'
import { JobHistory } from '@/components/extraction/job-history'
import { EngineCompare } from '@/components/extraction/engine-compare'
import { AnalyseSampleButton } from '@/components/extraction/analyse-sample-button'
import { Dashboard } from '@/components/extraction/dashboard'
import { SettingsPanel } from '@/components/extraction/settings-panel'
import type { TemplateDef, FieldDef } from '@/lib/templates/schema'

export default function Home() {
  const { data: session, status } = useSession()
  const { toast } = useToast()
  const [tab, setTab] = useState('extract')
  const [templates, setTemplates] = useState<TemplateDef[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateDef | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [result, setResult] = useState<ExtractionResponse | null>(null)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [refreshSignal, setRefreshSignal] = useState(0)

  // ── Show login page if not authenticated ─────────────────────────────────
  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Sparkles className="h-8 w-8 animate-pulse text-primary" />
          <div className="text-sm text-muted-foreground">Loading Aavanam…</div>
        </div>
      </div>
    )
  }

  if (status === 'unauthenticated' || !session) {
    return <LoginPage />
  }

  return <AuthenticatedApp
    session={session}
    tab={tab}
    setTab={setTab}
    templates={templates}
    setTemplates={setTemplates}
    selectedTemplateId={selectedTemplateId}
    setSelectedTemplateId={setSelectedTemplateId}
    selectedTemplate={selectedTemplate}
    setSelectedTemplate={setSelectedTemplate}
    isProcessing={isProcessing}
    setIsProcessing={setIsProcessing}
    result={result}
    setResult={setResult}
    selectedJobId={selectedJobId}
    setSelectedJobId={setSelectedJobId}
    refreshSignal={refreshSignal}
    setRefreshSignal={setRefreshSignal}
  />
}

// ─── Login page (simple form — signup happens via API call) ─────────────────

function LoginPage() {
  const { toast } = useToast()
  const [email, setEmail] = useState('admin@aavanam.local')
  const [password, setPassword] = useState('aavanam123')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      // Use next-auth/react signIn which sets the session cookie properly
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      })
      if (result?.error) {
        toast({ title: 'Login failed', description: 'Invalid email or password', variant: 'destructive' })
        setLoading(false)
        return
      }
      // Reload to apply session
      window.location.reload()
    } catch (e) {
      toast({ title: 'Login failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' })
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 rounded-xl bg-primary p-3 w-fit">
            <Sparkles className="h-7 w-7 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl">Aavanam</CardTitle>
          <CardDescription>AI Document Extraction Platform</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                required
              />
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
          <p className="text-xs text-muted-foreground mt-4 text-center">
            Demo credentials are pre-filled: <code className="text-foreground">admin@aavanam.local</code> / <code className="text-foreground">aavanam123</code>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Main authenticated app ─────────────────────────────────────────────────

type AuthenticatedAppProps = {
  session: ReturnType<typeof useSession>['data']
  tab: string
  setTab: (t: string) => void
  templates: TemplateDef[]
  setTemplates: React.Dispatch<React.SetStateAction<TemplateDef[]>>
  selectedTemplateId: string | null
  setSelectedTemplateId: React.Dispatch<React.SetStateAction<string | null>>
  selectedTemplate: TemplateDef | null
  setSelectedTemplate: React.Dispatch<React.SetStateAction<TemplateDef | null>>
  isProcessing: boolean
  setIsProcessing: React.Dispatch<React.SetStateAction<boolean>>
  result: ExtractionResponse | null
  setResult: React.Dispatch<React.SetStateAction<ExtractionResponse | null>>
  selectedJobId: string | null
  setSelectedJobId: React.Dispatch<React.SetStateAction<string | null>>
  refreshSignal: number
  setRefreshSignal: React.Dispatch<React.SetStateAction<number>>
}

function AuthenticatedApp(props: AuthenticatedAppProps) {
  const { session, tab, setTab } = props
  const { toast } = useToast()

  // Load templates
  useEffect(() => {
    fetch('/api/templates')
      .then(r => r.json())
      .then(d => {
        const list: TemplateDef[] = d.templates ?? []
        props.setTemplates(list)
        if (list.length > 0 && props.selectedTemplateId == null) {
          props.setSelectedTemplateId(list[0].id)
          props.setSelectedTemplate(list[0])
        }
      })
      .catch(e => toast({ title: 'Failed to load templates', description: String(e), variant: 'destructive' }))
  }, [toast])

  const handleFileSelected = useCallback(async (file: File) => {
    if (!props.selectedTemplateId) {
      toast({ title: 'No template selected', description: 'Pick or create a template first.', variant: 'destructive' })
      return
    }
    props.setIsProcessing(true)
    props.setResult(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('templateId', props.selectedTemplateId)
      formData.append('multiInvoice', 'auto')
      const res = await fetch('/api/extract', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data?.error?.message ?? `HTTP ${res.status}`)
      }
      props.setResult(data as ExtractionResponse)
      props.setSelectedJobId(data.job_id)
      props.setRefreshSignal(s => s + 1)
      toast({
        title: data.status === 'completed' ? 'Extraction complete' : 'Extraction has warnings',
        description: data.multi_invoice
          ? `${file.name} → ${data.template.name} (${data.document_count} invoices detected)`
          : `${file.name} → ${data.template.name}`,
      })
    } catch (e) {
      toast({ title: 'Extraction failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' })
    } finally {
      props.setIsProcessing(false)
    }
  }, [props, toast])

  const handleSelectJob = useCallback(async (jobId: string) => {
    props.setSelectedJobId(jobId)
    try {
      const res = await fetch(`/api/jobs/${jobId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`)

      const extracted = data.extracted_data ?? {}
      const validation = data.validation ?? { is_valid: false, missing_fields: [], issues: [] }
      const isMultiStored = validation.multi_invoice === true || (extracted && Array.isArray(extracted.documents))

      if (isMultiStored && extracted.documents) {
        props.setResult({
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
            validation: d.validation ?? validation,
          })),
          diagnostics: data.diagnostics ?? {},
          raw_ocr_text: data.raw_ocr_text ?? '',
          raw_llm_response: data.raw_llm_response ?? '',
        })
      } else {
        props.setResult({
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
  }, [props, setTab, toast])

  const handleTemplateSaved = useCallback((t: TemplateDef) => {
    props.setSelectedTemplate(t)
    props.setTemplates(ts => ts.map(x => x.id === t.id ? t : x))
    toast({ title: 'Template updated', description: t.name })
  }, [props, toast])

  const handleNewTemplateCreated = useCallback(async (
    templateName: string, fields: FieldDef[], instructions: string
  ) => {
    const res = await fetch('/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: templateName, documentType: 'invoice', fields, instructions }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err?.error?.message ?? `HTTP ${res.status}`)
    }
    const created = await res.json()
    const listRes = await fetch('/api/templates')
    const listData = await listRes.json()
    const list: TemplateDef[] = listData.templates ?? []
    props.setTemplates(list)
    const newTpl = list.find(t => t.id === created.id)
    if (newTpl) {
      props.setSelectedTemplateId(newTpl.id)
      props.setSelectedTemplate(newTpl)
    }
  }, [props])

  const download = useCallback((format: 'json' | 'csv' | 'xlsx') => {
    if (!props.result?.job_id) return
    window.open(`/api/jobs/${props.result.job_id}/export?format=${format}`, '_blank')
  }, [props.result?.job_id])

  const orgName = (session?.user as { organizationName?: string } | undefined)?.organizationName ?? 'Aavanam'

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary p-2">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight">Aavanam</h1>
              <p className="text-xs text-muted-foreground">
                AI Document Extraction · {orgName}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
              <User className="h-3.5 w-3.5" />
              <span>{session?.user?.email}</span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => signOut({ callbackUrl: '/' })}>
              <LogOut className="h-3.5 w-3.5 mr-1.5" />Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid grid-cols-5 w-full max-w-2xl mb-6">
            <TabsTrigger value="dashboard" className="gap-1.5">
              <LayoutDashboard className="h-4 w-4" /> Dashboard
            </TabsTrigger>
            <TabsTrigger value="extract" className="gap-1.5">
              <FileText className="h-4 w-4" /> Extract
            </TabsTrigger>
            <TabsTrigger value="templates" className="gap-1.5">
              <Settings className="h-4 w-4" /> Template
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-1.5">
              <History className="h-4 w-4" /> History
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-1.5">
              <User className="h-4 w-4" /> Settings
            </TabsTrigger>
          </TabsList>

          {/* ────── Dashboard tab ────── */}
          <TabsContent value="dashboard">
            <Dashboard onJumpToJob={(jobId) => { props.setSelectedJobId(jobId); handleSelectJob(jobId) }} />
          </TabsContent>

          {/* ────── Extract tab ────── */}
          <TabsContent value="extract" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Step 1 — Choose template and upload a document</CardTitle>
                <CardDescription>
                  Pick a template, then drop a PDF, PNG, JPG, TIFF, DOCX, or XLSX. The pipeline will
                  parse (or OCR), call the LLM with the template's schema, and validate the result.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-end gap-3">
                  <div className="space-y-1.5 flex-1 max-w-sm">
                    <label className="text-xs text-muted-foreground">Template</label>
                    <Select
                      value={props.selectedTemplateId ?? ''}
                      onValueChange={(v) => {
                        props.setSelectedTemplateId(v)
                        const t = props.templates.find(t => t.id === v)
                        if (t) props.setSelectedTemplate(t)
                      }}
                    >
                      <SelectTrigger><SelectValue placeholder="Select template" /></SelectTrigger>
                      <SelectContent>
                        {props.templates.map(t => (
                          <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="text-xs text-muted-foreground pb-2">
                    {props.selectedTemplate ? `${props.selectedTemplate.fields.length} fields` : '—'}
                  </div>
                </div>
                <UploadPanel onFileSelected={handleFileSelected} isProcessing={props.isProcessing} />
              </CardContent>
            </Card>

            {props.result && (
              <>
                <div className="flex items-center justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => download('json')}>
                    <Download className="h-3.5 w-3.5 mr-1" />JSON
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => download('csv')}>
                    <Download className="h-3.5 w-3.5 mr-1" />CSV
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => download('xlsx')}>
                    <Download className="h-3.5 w-3.5 mr-1" />XLSX
                  </Button>
                </div>
                <ExtractionResult result={props.result} />
                <EngineCompare
                  ocrEngine={props.result.diagnostics.ocr_engine}
                  ocrConfidence={props.result.diagnostics.ocr_confidence}
                  ocrTimeMs={props.result.diagnostics.ocr_time_ms}
                />
              </>
            )}
          </TabsContent>

          {/* ────── Template tab ────── */}
          <TabsContent value="templates" className="space-y-3">
            <div className="flex items-center justify-end">
              <AnalyseSampleButton onTemplateCreated={handleNewTemplateCreated} />
            </div>
            {props.selectedTemplate ? (
              <TemplateEditor template={props.selectedTemplate} onSaved={handleTemplateSaved} />
            ) : (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  No template loaded.
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ────── History tab ────── */}
          <TabsContent value="history">
            <JobHistory
              selectedJobId={props.selectedJobId}
              onSelectJob={handleSelectJob}
              refreshSignal={props.refreshSignal}
            />
          </TabsContent>

          {/* ────── Settings tab ────── */}
          <TabsContent value="settings">
            <SettingsPanel />
          </TabsContent>
        </Tabs>
      </main>

      <footer className="border-t mt-12 py-6 text-center text-xs text-muted-foreground">
        <div className="max-w-6xl mx-auto px-4">
          Aavanam · Per BRD §4 — provider-neutral adapters for OCR and LLM
        </div>
      </footer>
    </div>
  )
}
