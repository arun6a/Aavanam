'use client'

import { useState } from 'react'
import { Plus, Trash2, GripVertical, Save } from 'lucide-react'
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import type { FieldDef, FieldType, TemplateDef } from '@/lib/templates/schema'

type Props = {
  template: TemplateDef
  onSaved: (t: TemplateDef) => void
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

export function TemplateEditor({ template, onSaved }: Props) {
  const { toast } = useToast()
  const [name, setName] = useState(template.name)
  const [instructions, setInstructions] = useState(template.instructions ?? '')
  const [fields, setFields] = useState<FieldDef[]>(template.fields)
  const [saving, setSaving] = useState(false)

  const updateField = (idx: number, patch: Partial<FieldDef>) => {
    setFields(fs => fs.map((f, i) => i === idx ? { ...f, ...patch } : f))
  }
  const updateSubField = (idx: number, sidx: number, patch: Partial<Omit<FieldDef, 'subFields'>>) => {
    setFields(fs => fs.map((f, i) => {
      if (i !== idx || !f.subFields) return f
      return { ...f, subFields: f.subFields.map((sf, j) => j === sidx ? { ...sf, ...patch } : sf) }
    }))
  }
  const addField = () => {
    setFields(fs => [...fs, {
      name: `field_${fs.length + 1}`,
      label: 'New Field',
      type: 'string',
      required: false,
      description: '',
      sample: '',
    }])
  }
  const removeField = (idx: number) => {
    setFields(fs => fs.filter((_, i) => i !== idx))
  }
  const addSubField = (idx: number) => {
    setFields(fs => fs.map((f, i) => {
      if (i !== idx || f.type !== 'line_items') return f
      return { ...f, subFields: [...(f.subFields ?? []), {
        name: `sub_${(f.subFields?.length ?? 0) + 1}`,
        label: 'New Sub-field',
        type: 'string',
        required: false,
        description: '',
        sample: '',
      }] }
    }))
  }
  const removeSubField = (idx: number, sidx: number) => {
    setFields(fs => fs.map((f, i) => {
      if (i !== idx || !f.subFields) return f
      return { ...f, subFields: f.subFields.filter((_, j) => j !== sidx) }
    }))
  }

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/templates/${template.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, instructions, fields }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err?.error?.message ?? 'Failed to save')
      }
      const updated = await res.json()
      onSaved({ ...template, name: updated.name, instructions: updated.instructions, fields: updated.fields })
      toast({ title: 'Template saved', description: name })
    } catch (e) {
      toast({
        title: 'Save failed',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Template metadata</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="tpl-name">Name</Label>
            <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tpl-instructions">LLM instructions</Label>
            <Textarea
              id="tpl-instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Free-text instructions for the LLM about how to extract fields from this document type."
              className="min-h-[80px]"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Fields</CardTitle>
              <CardDescription>
                Define each field. The LLM will produce JSON matching this schema.
              </CardDescription>
            </div>
            <Button onClick={addField} size="sm">
              <Plus className="h-4 w-4 mr-1" /> Add field
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {fields.map((field, idx) => (
            <div key={idx} className="rounded-lg border p-3 space-y-3 bg-muted/20">
              <div className="flex items-center gap-2">
                <GripVertical className="h-4 w-4 text-muted-foreground" />
                <Input
                  className="flex-1 font-mono text-xs"
                  placeholder="field_name"
                  value={field.name}
                  onChange={(e) => updateField(idx, { name: e.target.value.replace(/[^a-zA-Z0-9_]/g, '_') })}
                />
                <Input
                  className="flex-1"
                  placeholder="Human-friendly label"
                  value={field.label}
                  onChange={(e) => updateField(idx, { label: e.target.value })}
                />
                <Button variant="ghost" size="icon" onClick={() => removeField(idx)}>
                  <Trash2 className="h-4 w-4 text-rose-500" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3 pl-6">
                <div className="space-y-1">
                  <Label className="text-xs">Type</Label>
                  <Select value={field.type} onValueChange={(v) => updateField(idx, { type: v as FieldType })}>
                    <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FIELD_TYPES.map(ft => (
                        <SelectItem key={ft.value} value={ft.value} className="text-xs">{ft.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end gap-2 pb-1">
                  <Switch
                    checked={field.required}
                    onCheckedChange={(checked) => updateField(idx, { required: checked })}
                  />
                  <Label className="text-xs">Required</Label>
                  {field.required && <Badge variant="secondary" className="text-xs ml-1">required</Badge>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 pl-6">
                <Input
                  className="text-xs"
                  placeholder="Description for LLM"
                  value={field.description ?? ''}
                  onChange={(e) => updateField(idx, { description: e.target.value })}
                />
                <Input
                  className="text-xs"
                  placeholder="Sample value"
                  value={field.sample ?? ''}
                  onChange={(e) => updateField(idx, { sample: e.target.value })}
                />
              </div>

              {field.type === 'line_items' && (
                <div className="pl-6 space-y-2 border-l-2 border-muted-foreground/20 ml-2">
                  <div className="flex items-center justify-between pt-2">
                    <Label className="text-xs font-semibold">Sub-fields (one per line column):</Label>
                    <Button variant="outline" size="sm" onClick={() => addSubField(idx)}>
                      <Plus className="h-3 w-3 mr-1" /> Sub-field
                    </Button>
                  </div>
                  {field.subFields?.map((sf, sidx) => (
                    <div key={sidx} className="grid grid-cols-12 gap-2 items-center text-xs">
                      <Input
                        className="col-span-3 font-mono"
                        placeholder="name"
                        value={sf.name}
                        onChange={(e) => updateSubField(idx, sidx, { name: e.target.value.replace(/[^a-zA-Z0-9_]/g, '_') })}
                      />
                      <Input
                        className="col-span-3"
                        placeholder="label"
                        value={sf.label}
                        onChange={(e) => updateSubField(idx, sidx, { label: e.target.value })}
                      />
                      <Select
                        value={sf.type}
                        onValueChange={(v) => updateSubField(idx, sidx, { type: v as FieldType })}
                      >
                        <SelectTrigger className="col-span-3"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {FIELD_TYPES.filter(t => t.value !== 'line_items').map(ft => (
                            <SelectItem key={ft.value} value={ft.value}>{ft.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="col-span-2 flex items-center gap-1">
                        <Switch
                          checked={sf.required}
                          onCheckedChange={(c) => updateSubField(idx, sidx, { required: c })}
                        />
                        <span className="text-muted-foreground">req</span>
                      </div>
                      <Button
                        variant="ghost" size="icon" className="col-span-1 h-7 w-7"
                        onClick={() => removeSubField(idx, sidx)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div className="pt-2">
            <Button onClick={save} disabled={saving}>
              <Save className="h-4 w-4 mr-1" />
              {saving ? 'Saving…' : 'Save template'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
