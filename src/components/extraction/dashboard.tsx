'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts'
import { Activity, Clock, DollarSign, CheckCircle2, AlertTriangle, FileText, TrendingUp, Users } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

type StatsResponse = {
  totals: {
    jobs: number
    completed: number
    review_required: number
    failed: number
    templates: number
    api_keys: number
    audit_events: number
  }
  by_template: Array<{ name: string; count: number }>
  last_30_days: Array<{ date: string; jobs: number; completed: number; failed: number }>
  recent_activity: Array<{
    id: string
    file_name: string
    template_name: string
    status: string
    ocr_engine: string | null
    total_processing_ms: number | null
    created_at: string
    has_extracted_data: boolean
  }>
  cost: {
    llm_tokens_in: number
    llm_tokens_out: number
    estimated_cost_usd: number
  }
  avg_processing_ms: number | null
  success_rate: number
}

type Props = {
  onJumpToJob?: (jobId: string) => void
}

export function Dashboard({ onJumpToJob }: Props) {
  const { toast } = useToast()
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const r = await fetch('/api/stats')
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const d: StatsResponse = await r.json()
        if (!cancelled) {
          setStats(d)
          setLoading(false)
        }
      } catch (e) {
        if (!cancelled) {
          toast({ title: 'Failed to load stats', description: e instanceof Error ? e.message : 'Unknown', variant: 'destructive' })
          setLoading(false)
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [toast])

  if (loading) {
    return <div className="text-muted-foreground text-sm">Loading dashboard…</div>
  }

  if (!stats) {
    return <div className="text-muted-foreground text-sm">No data yet.</div>
  }

  const COLORS = ['#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316']

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold">Dashboard</h2>
        <p className="text-sm text-muted-foreground">
          Usage stats, costs, and recent activity for your organization.
        </p>
      </div>

      {/* Top stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total jobs" value={stats.totals.jobs} icon={<FileText className="h-4 w-4" />} color="text-blue-600" />
        <StatCard label="Completed" value={stats.totals.completed} icon={<CheckCircle2 className="h-4 w-4" />} color="text-emerald-600" />
        <StatCard label="Review required" value={stats.totals.review_required} icon={<AlertTriangle className="h-4 w-4" />} color="text-amber-500" />
        <StatCard label="Failed" value={stats.totals.failed} icon={<XCircle className="h-4 w-4" />} color="text-rose-600" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Success rate" value={`${(stats.success_rate * 100).toFixed(0)}%`} icon={<TrendingUp className="h-4 w-4" />} color="text-emerald-600" />
        <StatCard
          label="Avg processing time"
          value={stats.avg_processing_ms != null ? `${(stats.avg_processing_ms / 1000).toFixed(1)}s` : '—'}
          icon={<Clock className="h-4 w-4" />}
          color="text-blue-600"
        />
        <StatCard
          label="LLM tokens (in+out)"
          value={`${((stats.cost.llm_tokens_in + stats.cost.llm_tokens_out) / 1000).toFixed(1)}K`}
          icon={<Activity className="h-4 w-4" />}
          color="text-violet-600"
        />
        <StatCard
          label="Est. cost (USD)"
          value={`$${stats.cost.estimated_cost_usd.toFixed(3)}`}
          icon={<DollarSign className="h-4 w-4" />}
          color="text-emerald-600"
        />
      </div>

      {/* Top stats row */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card><CardContent className="p-3">
          <div className="text-xs text-muted-foreground">Templates</div>
          <div className="font-bold text-xl">{stats.totals.templates}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-xs text-muted-foreground">API Keys</div>
          <div className="font-bold text-xl">{stats.totals.api_keys}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-xs text-muted-foreground">Audit events</div>
          <div className="font-bold text-xl">{stats.totals.audit_events}</div>
        </CardContent></Card>
      </div>

      {/* 30-day jobs chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Jobs in last 30 days</CardTitle>
          <CardDescription>Daily job submissions, completions, and failures</CardDescription>
        </CardHeader>
        <CardContent>
          {stats.last_30_days.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground text-sm">No jobs in the last 30 days.</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={stats.last_30_days}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="date" fontSize={11} tickLine={false} />
                <YAxis fontSize={11} tickLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '12px' }}
                />
                <Bar dataKey="jobs" name="Total" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="completed" name="Completed" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="failed" name="Failed" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Two-column: by-template + recent activity */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By template</CardTitle>
            <CardDescription>Jobs grouped by template used</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.by_template.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground text-sm">No jobs yet.</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={stats.by_template}
                    dataKey="count"
                    nameKey="name"
                    cx="50%" cy="50%"
                    outerRadius={80}
                    label={(entry) => entry.name}
                  >
                    {stats.by_template.map((_, idx) => (
                      <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '12px' }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent activity</CardTitle>
            <CardDescription>Latest 10 jobs — click to view</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-[260px]">
              {stats.recent_activity.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground text-sm">No activity yet.</div>
              ) : (
                <div className="space-y-2">
                  {stats.recent_activity.map(j => (
                    <button
                      key={j.id}
                      onClick={() => onJumpToJob?.(j.id)}
                      className="w-full text-left rounded-md border p-2 hover:bg-muted/40 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {j.status === 'completed' && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 flex-shrink-0" />}
                          {j.status === 'review_required' && <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />}
                          {j.status === 'failed' && <XCircle className="h-3.5 w-3.5 text-rose-600 flex-shrink-0" />}
                          <span className="font-medium text-xs truncate">{j.file_name}</span>
                        </div>
                        <span className="text-xs text-muted-foreground flex-shrink-0">
                          {new Date(j.created_at).toLocaleString()}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 pl-5 truncate">
                        {j.template_name} · {j.status} · {j.total_processing_ms != null ? `${(j.total_processing_ms / 1000).toFixed(1)}s` : '—'}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function StatCard({ label, value, icon, color }: { label: string; value: string | number; icon: React.ReactNode; color?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <span className={color}>{icon}</span>
          {label}
        </div>
        <div className="font-bold text-lg mt-1">{value}</div>
      </CardContent>
    </Card>
  )
}

function XCircle({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  )
}
