'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { InfoIcon } from 'lucide-react'

type Props = {
  ocrEngine: string | null
  ocrConfidence: number | null
  ocrTimeMs: number | null
}

/**
 * Side-by-side OCR engine comparison panel.
 *
 * Per BRD §4: "provider-neutral adapter pattern" — we ship Tesseract (real),
 * and PaddleOCR is a stub. When deployed to a Python-capable server, the
 * PaddleAdapter in /lib/ocr/index.ts gets a real implementation and this panel
 * starts showing both engines' results.
 */
export function EngineCompare({ ocrEngine, ocrConfidence, ocrTimeMs }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">OCR engine comparison</CardTitle>
        <CardDescription>
          Multiple engines can run side-by-side. Per BRD §4 provider-neutral
          adapter pattern — swap any engine in/out without touching extraction code.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <EngineCard
          name="Tesseract 5"
          subtitle="System tesseract via CLI"
          available={true}
          usedForThisJob={ocrEngine === 'tesseract'}
          confidence={ocrEngine === 'tesseract' ? ocrConfidence : null}
          timeMs={ocrEngine === 'tesseract' ? ocrTimeMs : null}
        />
        <EngineCard
          name="PaddleOCR v5"
          subtitle="Python worker required"
          available={false}
          usedForThisJob={ocrEngine === 'paddleocr'}
          confidence={ocrEngine === 'paddleocr' ? ocrConfidence : null}
          timeMs={ocrEngine === 'paddleocr' ? ocrTimeMs : null}
          note="Needs Python sidecar. Will be available after deployment to a server with Python installed. The adapter interface in /lib/ocr is already wired — only the implementation needs to be filled in."
        />
      </CardContent>
    </Card>
  )
}

function EngineCard({
  name, subtitle, available, usedForThisJob, confidence, timeMs, note,
}: {
  name: string
  subtitle: string
  available: boolean
  usedForThisJob: boolean
  confidence: number | null
  timeMs: number | null
  note?: string
}) {
  return (
    <div
      className={`rounded-lg border p-3 space-y-2 ${available ? 'bg-card' : 'bg-muted/40 opacity-70'}`}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="font-semibold text-sm flex items-center gap-2">
            {name}
            {usedForThisJob && <Badge variant="default" className="text-xs">used</Badge>}
          </div>
          <div className="text-xs text-muted-foreground">{subtitle}</div>
        </div>
        <Badge variant={available ? 'default' : 'secondary'} className="text-xs">
          {available ? 'available' : 'stub'}
        </Badge>
      </div>
      {available && usedForThisJob && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <div className="text-muted-foreground">Confidence</div>
            <div className="font-mono">{confidence != null ? `${(confidence * 100).toFixed(1)}%` : '—'}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Time</div>
            <div className="font-mono">{timeMs != null ? `${timeMs}ms` : '—'}</div>
          </div>
        </div>
      )}
      {!available && note && (
        <div className="text-xs text-muted-foreground flex items-start gap-1.5 pt-1 border-t">
          <InfoIcon className="h-3 w-3 flex-shrink-0 mt-0.5" />
          <span>{note}</span>
        </div>
      )}
    </div>
  )
}
