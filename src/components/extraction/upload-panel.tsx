'use client'

import { useCallback, useState } from 'react'
import { Upload, FileText, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

type Props = {
  onFileSelected: (file: File) => void
  isProcessing: boolean
}

export function UploadPanel({ onFileSelected, isProcessing }: Props) {
  const { toast } = useToast()
  const [dragging, setDragging] = useState(false)

  const handleFile = useCallback((file: File | undefined) => {
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: 'File too large', description: 'Max size is 10 MB', variant: 'destructive' })
      return
    }
    const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp']
    if (!allowed.includes(file.type)) {
      toast({ title: 'Unsupported file', description: `Type ${file.type} not supported. Use PDF, PNG, or JPG.`, variant: 'destructive' })
      return
    }
    onFileSelected(file)
  }, [toast, onFileSelected])

  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        handleFile(e.dataTransfer.files?.[0])
      }}
      className={cn(
        'flex flex-col items-center justify-center gap-3 p-10 rounded-xl border-2 border-dashed cursor-pointer transition-colors min-h-[280px]',
        dragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/40 hover:border-primary/60 hover:bg-muted/50',
        isProcessing && 'opacity-60 pointer-events-none',
      )}
    >
      {isProcessing ? (
        <>
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <div className="text-center">
            <div className="font-semibold text-lg">Processing…</div>
            <div className="text-sm text-muted-foreground mt-1">OCR + LLM extraction in progress</div>
          </div>
        </>
      ) : (
        <>
          <div className="rounded-full bg-primary/10 p-3">
            <Upload className="h-8 w-8 text-primary" />
          </div>
          <div className="text-center">
            <div className="font-semibold text-lg">Drop a document here</div>
            <div className="text-sm text-muted-foreground mt-1">
              PDF, PNG, or JPG · max 10 MB
            </div>
          </div>
          <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />
            <span>Click to browse</span>
          </div>
        </>
      )}
      <input
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.webp"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
    </label>
  )
}
