'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Copy, Plus, Trash2, Eye, EyeOff, KeyRound, Webhook, FileClock, User as UserIcon, RefreshCw } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

type ApiKeyView = {
  id: string
  keyPrefix: string
  name: string | null
  status: string
  scopes: string
  lastUsedAt: string | null
  createdAt: string
}

type WebhookView = {
  id: string
  url: string
  events: string
  status: string
  lastTriggeredAt: string | null
  lastResponseCode: number | null
  createdAt: string
}

type AuditLogView = {
  id: string
  actorType: string
  actorEmail?: string | null
  action: string
  resourceType: string | null
  resourceId: string | null
  metadata: Record<string, unknown> | null
  timestamp: string
}

export function SettingsPanel() {
  return (
    <div className="space-y-6">
      <ProfileSection />
      <ApiKeysSection />
      <WebhooksSection />
      <AuditLogSection />
    </div>
  )
}

// ─── Profile ────────────────────────────────────────────────────────────────

type SessionInfo = { user?: { email?: string | null; name?: string | null; organizationName?: string } } | null

function ProfileSection() {
  const [session, setSession] = useState<SessionInfo>(null)

  useEffect(() => {
    fetch('/api/auth/session').then(r => r.json()).then(setSession).catch(() => {})
  }, [])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <UserIcon className="h-4 w-4" /> Profile
        </CardTitle>
        <CardDescription>Your account and organization</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex justify-between"><span className="text-muted-foreground">Email</span><span className="font-mono">{session?.user?.email ?? '—'}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Name</span><span>{session?.user?.name ?? '—'}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Organization</span><span>{session?.user?.organizationName ?? '—'}</span></div>
      </CardContent>
    </Card>
  )
}

// ─── API Keys ───────────────────────────────────────────────────────────────

function ApiKeysSection() {
  const { toast } = useToast()
  const [keys, setKeys] = useState<ApiKeyView[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [newKeyScopes, setNewKeyScopes] = useState('extract:write,extract:read,templates:read')
  const [revealedKey, setRevealedKey] = useState<{ key: string; name: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/api-keys')
      const d = await r.json()
      setKeys(d.keys ?? [])
    } catch (e) {
      toast({ title: 'Failed to load keys', description: String(e), variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  const create = async () => {
    if (!newKeyName.trim()) {
      toast({ title: 'Name required', variant: 'destructive' })
      return
    }
    setCreating(true)
    try {
      const r = await fetch('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName, scopes: newKeyScopes }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error?.message ?? 'Failed')
      setRevealedKey({ key: d.key, name: newKeyName })
      setNewKeyName('')
      await load()
      toast({ title: 'API key created', description: 'Save the key now — shown only once.' })
    } catch (e) {
      toast({ title: 'Failed', description: e instanceof Error ? e.message : 'Unknown', variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  const revoke = async (id: string) => {
    if (!confirm('Revoke this API key? It cannot be undone.')) return
    try {
      await fetch(`/api/api-keys/${id}`, { method: 'DELETE' })
      await load()
      toast({ title: 'Key revoked' })
    } catch (e) {
      toast({ title: 'Failed', description: String(e), variant: 'destructive' })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <KeyRound className="h-4 w-4" /> API Keys
        </CardTitle>
        <CardDescription>
          Generate keys for external apps to call the public API. Each key is shown only ONCE.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Create form */}
        <div className="rounded-md border p-3 space-y-3 bg-muted/20">
          <div className="text-sm font-medium">Create new key</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Name (human label)</Label>
              <Input
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="e.g. Production ERP"
                className="text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Scopes (comma-separated)</Label>
              <Input
                value={newKeyScopes}
                onChange={(e) => setNewKeyScopes(e.target.value)}
                className="text-sm font-mono"
              />
            </div>
          </div>
          <Button onClick={create} disabled={creating} size="sm">
            <Plus className="h-4 w-4 mr-1.5" />
            {creating ? 'Generating…' : 'Generate key'}
          </Button>
        </div>

        {/* Reveal new key */}
        {revealedKey && (
          <div className="rounded-md border-2 border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-emerald-700 dark:text-emerald-400">✓ Key created: {revealedKey.name}</div>
              <Button
                variant="ghost" size="sm" className="h-7"
                onClick={() => navigator.clipboard.writeText(revealedKey.key)}
              >
                <Copy className="h-3 w-3 mr-1" />Copy
              </Button>
            </div>
            <code className="block text-xs font-mono bg-background p-2 rounded border break-all">
              {revealedKey.key}
            </code>
            <p className="text-xs text-muted-foreground">
              ⚠️ Copy this key now. It will not be shown again.
            </p>
            <Button variant="outline" size="sm" onClick={() => setRevealedKey(null)}>Dismiss</Button>
          </div>
        )}

        {/* Existing keys */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium">Existing keys ({keys.length})</div>
            <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className="h-3 w-3 mr-1" />Refresh
            </Button>
          </div>
          {keys.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">No keys yet. Create one above.</div>
          ) : (
            <div className="space-y-2">
              {keys.map(k => (
                <div key={k.id} className="flex items-center justify-between rounded-md border p-2.5 text-sm">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <code className="font-mono text-xs">{k.keyPrefix}…</code>
                      <span className="font-medium truncate">{k.name}</span>
                      <Badge variant={k.status === 'active' ? 'default' : 'secondary'} className="text-xs">
                        {k.status}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Last used: {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'never'} · Created {new Date(k.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  {k.status === 'active' && (
                    <Button variant="ghost" size="sm" onClick={() => revoke(k.id)}>
                      <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Webhooks ──────────────────────────────────────────────────────────────

function WebhooksSection() {
  const { toast } = useToast()
  const [webhooks, setWebhooks] = useState<WebhookView[]>([])
  const [loading, setLoading] = useState(true)
  const [newUrl, setNewUrl] = useState('')
  const [newEvents, setNewEvents] = useState('job.completed,job.failed,job.review_required')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/webhooks')
      const d = await r.json()
      setWebhooks(d.webhooks ?? [])
    } catch (e) {
      toast({ title: 'Failed to load webhooks', description: String(e), variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  const create = async () => {
    if (!newUrl.trim() || !newUrl.startsWith('http')) {
      toast({ title: 'URL required', description: 'Must start with http:// or https://', variant: 'destructive' })
      return
    }
    setCreating(true)
    try {
      const r = await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: newUrl, events: newEvents }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error?.message ?? 'Failed')
      setNewUrl('')
      await load()
      toast({ title: 'Webhook added' })
    } catch (e) {
      toast({ title: 'Failed', description: e instanceof Error ? e.message : 'Unknown', variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  const remove = async (id: string) => {
    if (!confirm('Delete this webhook?')) return
    try {
      await fetch(`/api/webhooks/${id}`, { method: 'DELETE' })
      await load()
      toast({ title: 'Webhook deleted' })
    } catch (e) {
      toast({ title: 'Failed', description: String(e), variant: 'destructive' })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Webhook className="h-4 w-4" /> Webhooks
        </CardTitle>
        <CardDescription>
          Receive a POST notification when jobs complete. We sign with HMAC SHA-256.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border p-3 space-y-3 bg-muted/20">
          <div className="text-sm font-medium">Add webhook</div>
          <div className="space-y-1">
            <Label className="text-xs">Endpoint URL (must be HTTPS)</Label>
            <Input
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://your-app.com/api/aavanam-webhook"
              className="text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Events (comma-separated)</Label>
            <Input
              value={newEvents}
              onChange={(e) => setNewEvents(e.target.value)}
              className="text-sm font-mono"
            />
          </div>
          <Button onClick={create} disabled={creating} size="sm">
            <Plus className="h-4 w-4 mr-1.5" />
            {creating ? 'Adding…' : 'Add webhook'}
          </Button>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium">Existing webhooks ({webhooks.length})</div>
            <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className="h-3 w-3 mr-1" />Refresh
            </Button>
          </div>
          {webhooks.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">No webhooks yet.</div>
          ) : (
            <div className="space-y-2">
              {webhooks.map(w => (
                <div key={w.id} className="flex items-start justify-between rounded-md border p-2.5 text-sm gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <code className="text-xs truncate">{w.url}</code>
                      <Badge variant={w.status === 'active' ? 'default' : 'secondary'} className="text-xs">{w.status}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Events: {w.events}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Last triggered: {w.lastTriggeredAt ? `${new Date(w.lastTriggeredAt).toLocaleString()} (HTTP ${w.lastResponseCode})` : 'never'}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => remove(w.id)}>
                    <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Audit log ──────────────────────────────────────────────────────────────

function AuditLogSection() {
  const { toast } = useToast()
  const [logs, setLogs] = useState<AuditLogView[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/audit-logs')
      const d = await r.json()
      setLogs(d.logs ?? [])
    } catch (e) {
      toast({ title: 'Failed to load audit log', description: String(e), variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <FileClock className="h-4 w-4" /> Audit Log
        </CardTitle>
        <CardDescription>
          Every state-changing action is logged here. Immutable for compliance.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium">{logs.length} events</div>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className="h-3 w-3 mr-1" />Refresh
          </Button>
        </div>
        <ScrollArea className="max-h-[400px]">
          {logs.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">No audit events yet.</div>
          ) : (
            <div className="space-y-1.5">
              {logs.map(l => (
                <div key={l.id} className="rounded-md border p-2 text-xs">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono">{l.action}</Badge>
                    <Badge variant="secondary" className="text-xs">{l.actorType}</Badge>
                    {l.actorEmail && <span className="text-muted-foreground">{l.actorEmail}</span>}
                    <span className="text-muted-foreground ml-auto">{new Date(l.timestamp).toLocaleString()}</span>
                  </div>
                  {l.resourceType && (
                    <div className="text-muted-foreground mt-1">
                      on <span className="font-mono">{l.resourceType}</span>
                      {l.resourceId && <span className="font-mono"> ({l.resourceId.slice(0, 12)})</span>}
                    </div>
                  )}
                  {l.metadata && Object.keys(l.metadata).length > 0 && (
                    <pre className="text-[10px] font-mono mt-1 bg-muted/40 p-1.5 rounded overflow-x-auto">
                      {JSON.stringify(l.metadata, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
