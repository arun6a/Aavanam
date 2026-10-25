'use client'

import { useState, useCallback } from 'react'
import { Sparkles, Upload, Loader2, Plus, Check } from 'lucide-react'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import type { FieldDef, FieldType } from '@/lib/templates/schema'

type AnalyseResponse = {
  suggested_fields: FieldDef[]
  text_length: number
  detected_doc_type?: string
}

type Props = {
  onTemplateCreated: (templateName: string, fields: FieldDef[], instructions: string) => Promise<void>
}

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'string', label: 'String' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date (YYYY-MM-DD)' },
  { value: 'currency', label: 'Currency (number)' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'line_items', label: 'Line items (array of objects)' },
]

export function AnalyseSampleButton({ onTemplateCreated }: Props) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [analysing, setAnalysing] = useState(false)
  const [suggestions, setSuggestions] = useState<FieldDef[] | null>(null)
  const [detectedType, setDetectedType] = useState<string>('')
  const [textLength, setTextLength] = useState(0)
  const [templateName, setTemplateName] = useState('')
  const [instructions, setInstructions] = useState('')
  const [saving, setSaving] = useState(false)
  // Track which suggestions user wants to accept (default: all true)
  const [accepted, setAccepted] = useState<Set<number>>(new Set())

  const handleFile = useCallback((f: File | undefined) => {
    if (!f) return
    if (f.size > 10 * 1024 * 1024) {
      toast({ title: 'File too large', description: 'Max 10 MB', variant: 'destructive' })
      return
    }
    const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp']
    if (!allowed.includes(f.type)) {
      toast({ title: 'Unsupported', description: `Type ${f.type} not supported`, variant: 'destructive' })
      return
    }
    setFile(f)
    setSuggestions(null)
  }, [toast])

  const runAnalyse = useCallback(async () => {
    if (!file) return
    setAnalysing(true)
    setSuggestions(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/analyse', { method: 'POST', body: formData })
      const data: AnalyseResponse = await res.json()
      if (!res.ok) throw new Error((data as unknown as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`)
      if (!data.suggested_fields || data.suggested_fields.length === 0) {
        toast({
          title: 'No fields detected',
          description: data.text_length === 0
            ? 'Could not extract text from this document. Try a different sample.'
            : 'AI did not suggest any fields. Try a clearer document.',
          variant: 'destructive',
        })
        return
      }
      setSuggestions(data.suggested_fields)
      setDetectedType(data.detected_doc_type ?? 'unknown')
      setTextLength(data.text_length)
      // Default: accept all
      setAccepted(new Set(data.suggested_fields.map((_, i) => i)))
      // Suggest template name based on detected type
      if (!templateName) {
        const pretty = data.detected_doc_type
          ? data.detected_doc_type.charAt(0).toUpperCase() + data.detected_doc_type.slice(1).replace('_', ' ')
          : 'New Template'
        setTemplateName(`${pretty} (auto-detected)`)
      }
      toast({
        title: 'AI suggested fields',
        description: `${data.suggested_fields.length} fields detected for "${data.detected_doc_type ?? 'unknown'}"`,
      })
    } catch (e) {
      toast({ title: 'Analyse failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' })
    } finally {
      setAnalysing(false)
    }
  }, [file, templateName, toast])

  const toggleAccepted = (i: number) => {
    setAccepted(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const updateField = (i: number, patch: Partial<FieldDef>) => {
    setSuggestions(fs => fs ? fs.map((f, idx) => idx === i ? { ...f, ...patch } : f) : null)
  }

  const createTemplate = useCallback(async () => {
    if (!suggestions) return
    const finalFields = suggestions.filter((_, i) => accepted.has(i))
    if (finalFields.length === 0) {
      toast({ title: 'No fields selected', description: 'Select at least one field to create a template.', variant: 'destructive' })
      return
    }
    if (!templateName.trim()) {
      toast({ title: 'Name required', description: 'Give the template a name first.', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const defaultInstructions = `Extract fields from this ${detectedType} document. Use null for missing fields. Numbers as plain numbers. Dates as YYYY-MM-DD.`
      await onTemplateCreated(templateName.trim(), finalFields, instructions || defaultInstructions)
      toast({ title: 'Template created', description: `${templateName} with ${finalFields.length} fields` })
      // Reset
      setOpen(false)
      setFile(null)
      setSuggestions(null)
      setTemplateName('')
      setInstructions('')
      setAccepted(new Set())
    } catch (e) {
      toast({ title: 'Create failed', description: e instanceof Error ? e.message : 'Unknown', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }, [suggestions, accepted, templateName, instructions, detectedType, onTemplateCreated, toast])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Sparkles className="h-4 w-4 mr-1.5" />
          Analyse sample → suggest fields
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            AI Field Suggestion
          </DialogTitle>
          <DialogDescription>
            Upload a sample document. The AI will inspect it and suggest a list of fields
            you should extract. Per BRD §3 US-03 — system proposes, user edits.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1">
          <div className="space-y-4 pr-2">
            {/* Step 1: upload */}
            {!suggestions && (
              <div className="space-y-3">
                <div className="text-sm font-medium">Step 1 — Upload a sample document</div>
                <label className="block">
                  <div className="border-2 border-dashed border-muted-foreground/40 rounded-lg p-6 hover:bg-muted/40 cursor-pointer text-center">
                    {file ? (
                      <div>
                        <div className="font-medium">{file.name}</div>
                        <div className="text-xs text-muted-foreground mt-1">{(file.size / 1024).toFixed(1)} KB · {file.type}</div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2 py-4">
                        <Upload className="h-8 w-8 text-muted-foreground" />
                        <div className="text-sm">Click to browse · PDF, PNG, or JPG</div>
                      </div>
                    )}
                  </div>
                  <input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.webp"
                    className="hidden"
                    onChange={(e) => handleFile(e.target.files?.[0])}
                  />
                </label>
                <Button onClick={runAnalyse} disabled={!file || analysing} className="w-full">
                  {analysing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Analysing…
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-1.5" />Analyse sample
                    </>
                  )}
                </Button>
                <div className="text-xs text-muted-foreground">
                  The AI will extract text (PDF parse or OCR for images) and inspect it to
                  suggest a list of fields. This may take 10-30 seconds.
                </div>
              </div>
            )}

            {/* Step 2: review + edit suggestions */}
            {suggestions && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">Step 2 — Review and edit</div>
                    <div className="text-xs text-muted-foreground">
                      Detected type: <Badge variant="secondary">{detectedType}</Badge> · {textLength} chars extracted · {suggestions.length} fields suggested
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => { setSuggestions(null); setFile(null) }}>
                    Start over
                  </Button>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="tpl-name" className="text-xs">New template name</Label>
                  <Input
                    id="tpl-name"
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    placeholder="e.g. Indian GST Invoice, Receipt, Purchase Order"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tpl-instructions" className="text-xs">LLM instructions (optional)</Label>
                  <Input
                    id="tpl-instructions"
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    placeholder="Default auto-generated based on detected type"
                  />
                </div>

                <div className="border rounded-lg">
                  <div className="px-3 py-2 border-b bg-muted/30 flex items-center justify-between">
                    <div className="text-xs font-semibold">Suggested fields ({accepted.size}/{suggestions.length} accepted)</div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setAccepted(new Set(suggestions.map((_, i) => i)))}>
                        <Check className="h-3 w-3 mr-1" />All
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setAccepted(new Set())}>
                        None
                      </Button>
                    </div>
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {suggestions.map((field, i) => {
                      const isAccepted = accepted.has(i)
                      return (
                        <div key={i} className={`p-2 border-b last:border-b-0 ${isAccepted ? 'bg-card' : 'bg-muted/30 opacity-60'}`}>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={isAccepted}
                              onCheckedChange={() => toggleAccepted(i)}
                            />
                            <Input
                              className="flex-1 font-mono text-xs h-7"
                              value={field.name}
                              onChange={(e) => updateField(i, { name: e.target.value.replace(/[^a-zA-Z0-9_]/g, '_') })}
                            />
                            <Input
                              className="flex-1 text-xs h-7"
                              value={field.label}
                              onChange={(e) => updateField(i, { label: e.target.value })}
                            />
                            <Select
                              value={field.type}
                              onValueChange={(v) => updateField(i, { type: v as FieldType })}
                            >
                              <SelectTrigger className="w-36 h-7 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {FIELD_TYPES.map(ft => (
                                  <SelectItem key={ft.value} value={ft.value} className="text-xs">{ft.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="pl-9 mt-1 text-xs text-muted-foreground">
                            {field.description ?? '(no description)'}
                            {field.sample && (
                              <span className="ml-2 italic">e.g. {field.sample}</span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <Button onClick={createTemplate} disabled={saving || accepted.size === 0} className="w-full">
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Creating…
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4 mr-1.5" />
                      Create template with {accepted.size} field{accepted.size === 1 ? '' : 's'}
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
