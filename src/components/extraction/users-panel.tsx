'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { UserPlus, Users as UsersIcon, Trash2, Shield, RefreshCw } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

type Member = {
  id: string
  user_id: string
  email: string
  name: string | null
  role: string
  status: string
  joined_at: string
}

export function UsersPanel() {
  const { toast } = useToast()
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('member')
  const [inviting, setInviting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/org-members')
      if (!r.ok) {
        if (r.status === 403) {
          toast({ title: 'Admin only', description: 'Only org admins can view members.', variant: 'destructive' })
          setMembers([])
          return
        }
        throw new Error(`HTTP ${r.status}`)
      }
      const d = await r.json()
      setMembers(d.members ?? [])
    } catch (e) {
      toast({ title: 'Failed to load members', description: e instanceof Error ? e.message : 'Unknown', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  const invite = async () => {
    if (!inviteEmail.trim()) {
      toast({ title: 'Email required', variant: 'destructive' })
      return
    }
    setInviting(true)
    try {
      const r = await fetch('/api/org-members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      })
      const d = await r.json()
      if (!r.ok) {
        if (d?.error?.code === 'USER_NOT_FOUND') {
          toast({
            title: 'User not found',
            description: `${inviteEmail} has not signed up yet. Ask them to create an account first.`,
            variant: 'destructive',
          })
        } else {
          throw new Error(d?.error?.message ?? 'Failed')
        }
      } else {
        toast({ title: 'Member added', description: `${inviteEmail} is now a ${inviteRole}.` })
        setInviteEmail('')
        await load()
      }
    } catch (e) {
      toast({ title: 'Invite failed', description: e instanceof Error ? e.message : 'Unknown', variant: 'destructive' })
    } finally {
      setInviting(false)
    }
  }

  const changeRole = async (memberId: string, newRole: string) => {
    try {
      const r = await fetch(`/api/org-members/${memberId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      })
      if (!r.ok) {
        const d = await r.json()
        throw new Error(d?.error?.message ?? `HTTP ${r.status}`)
      }
      toast({ title: 'Role updated', description: `Now ${newRole}` })
      await load()
    } catch (e) {
      toast({ title: 'Failed', description: e instanceof Error ? e.message : 'Unknown', variant: 'destructive' })
    }
  }

  const remove = async (memberId: string, email: string) => {
    if (!confirm(`Remove ${email} from the organization?`)) return
    try {
      const r = await fetch(`/api/org-members/${memberId}`, { method: 'DELETE' })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error?.message ?? `HTTP ${r.status}`)
      toast({ title: 'Member removed', description: email })
      await load()
    } catch (e) {
      toast({ title: 'Failed', description: e instanceof Error ? e.message : 'Unknown', variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <UsersIcon className="h-5 w-5" /> Users
        </h2>
        <p className="text-sm text-muted-foreground">
          Manage members of your organization. Admins can invite users, change roles, and remove members.
        </p>
      </div>

      {/* Invite */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <UserPlus className="h-4 w-4" /> Invite member
          </CardTitle>
          <CardDescription>
            Add an existing user by email. They must have signed up first.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div className="md:col-span-2 space-y-1">
              <Label className="text-xs">Email</Label>
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@company.com"
                className="text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Role</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member (extract + view)</SelectItem>
                  <SelectItem value="admin">Admin (manage everything)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={invite} disabled={inviting} size="sm">
            <UserPlus className="h-4 w-4 mr-1.5" />
            {inviting ? 'Adding…' : 'Add member'}
          </Button>
        </CardContent>
      </Card>

      {/* Member list */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Members ({members.length})</CardTitle>
              <CardDescription>Current members of your organization</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className="h-3 w-3 mr-1" />Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground py-4 text-center">Loading…</div>
          ) : members.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">No members (or you may not have admin access).</div>
          ) : (
            <div className="space-y-2">
              {members.map(m => (
                <div key={m.id} className="flex items-center justify-between gap-3 rounded-md border p-2.5 text-sm">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{m.email}</span>
                      {m.role === 'admin' && (
                        <Badge variant="default" className="text-xs gap-1">
                          <Shield className="h-3 w-3" />admin
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {m.name ?? 'No name'} · joined {new Date(m.joined_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select value={m.role} onValueChange={(v) => changeRole(m.id, v)}>
                      <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="member">Member</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost" size="sm" className="h-7 w-7"
                      onClick={() => remove(m.id, m.email)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
