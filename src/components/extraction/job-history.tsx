'use client'

import { useEffect, useState } from 'react'
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { FileText, Download, Trash2, RefreshCw, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

type JobListItem = {
  id: string
  template_id: string
  template_name: string
  file_name: string
  file_size: number
  mime_type: string
  status: string
  stage: string | null
  ocr_engine: string | null
  ocr_confidence: number | null
  llm_model: string | null
  total_processing_ms: number | null
  created_at: string
  completed_at: string | null
  has_extracted_data: boolean
}

type Props = {
  selectedJobId: string | null
  onSelectJob: (jobId: string) => void
  refreshSignal: number
}

export function JobHistory({ selectedJobId, onSelectJob, refreshSignal }: Props) {
  const { toast } = useToast()
  const [jobs, setJobs] = useState<JobListItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const r = await fetch('/api/jobs')
        const d = await r.json()
        if (!cancelled) {
          setJobs(d.jobs ?? [])
          setLoading(false)
        }
      } catch (e) {
        if (!cancelled) {
          toast({ title: 'Failed to load jobs', description: String(e), variant: 'destructive' })
          setLoading(false)
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [refreshSignal, toast])

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/jobs/${id}`, { method: 'DELETE' })
      setJobs(js => js.filter(j => j.id !== id))
      toast({ title: 'Job deleted' })
    } catch (e) {
      toast({ title: 'Delete failed', description: String(e), variant: 'destructive' })
    }
  }

  const download = async (jobId: string, format: 'json' | 'csv') => {
    window.open(`/api/jobs/${jobId}/export?format=${format}`, '_blank')
  }

  if (loading) {
    return <div className="text-muted-foreground text-sm">Loading history…</div>
  }

  if (jobs.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <FileText className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <div>No jobs yet. Upload a document to get started.</div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Recent jobs</h3>
        <Badge variant="outline">{jobs.length}</Badge>
      </div>
      <ScrollArea className="max-h-[600px]">
        <div className="space-y-2 pr-2">
          {jobs.map(job => (
            <Card
              key={job.id}
              className={`cursor-pointer transition-colors ${selectedJobId === job.id ? 'border-primary ring-1 ring-primary' : 'hover:bg-muted/40'}`}
              onClick={() => onSelectJob(job.id)}
            >
              <CardContent className="p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {job.status === 'completed' && <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" />}
                      {job.status === 'review_required' && <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />}
                      {job.status === 'failed' && <XCircle className="h-4 w-4 text-rose-600 flex-shrink-0" />}
                      <div className="font-medium text-sm truncate">{job.file_name}</div>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 truncate">
                      {job.template_name} · {new Date(job.created_at).toLocaleString()}
                    </div>
                  </div>
                  <Button
                    variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0"
                    onClick={(e) => { e.stopPropagation(); handleDelete(job.id) }}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                  </Button>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-xs font-mono">{job.status}</Badge>
                  {job.ocr_engine && (
                    <Badge variant="secondary" className="text-xs">{job.ocr_engine}</Badge>
                  )}
                  {job.total_processing_ms != null && (
                    <span className="text-xs text-muted-foreground">
                      {(job.total_processing_ms / 1000).toFixed(1)}s
                    </span>
                  )}
                  {job.has_extracted_data && (
                    <div className="ml-auto flex items-center gap-1">
                      <Button
                        variant="outline" size="sm" className="h-6 text-xs px-2"
                        onClick={(e) => { e.stopPropagation(); download(job.id, 'json') }}
                      >
                        <Download className="h-3 w-3 mr-1" />JSON
                      </Button>
                      <Button
                        variant="outline" size="sm" className="h-6 text-xs px-2"
                        onClick={(e) => { e.stopPropagation(); download(job.id, 'csv') }}
                      >
                        <Download className="h-3 w-3 mr-1" />CSV
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}

export function RefreshButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick}>
      <RefreshCw className="h-3.5 w-3.5 mr-1" />Refresh
    </Button>
  )
}
