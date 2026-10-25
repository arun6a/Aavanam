/**
 * NextAuth.js configuration.
 *
 * Uses Credentials provider (email + password) with bcryptjs for password hashing.
 * The session JWT contains the user's ID + the org they belong to, which other
 * API routes read via `getSession()`.
 */

import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
  },
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null
        const user = await db.user.findUnique({
          where: { email: credentials.email.toLowerCase() },
        })
        if (!user) return null
        if (user.status !== 'active') return null
        const ok = await bcrypt.compare(credentials.password, user.passwordHash)
        if (!ok) return null
        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.userId as string
        // Look up the user's default org (first membership) so all queries can scope by it
        const membership = await db.organizationMember.findFirst({
          where: { userId: token.userId as string, organization: { status: 'active' } },
          orderBy: { createdAt: 'asc' },
          include: { organization: true },
        })
        if (membership) {
          ;(session.user as { organizationId?: string }).organizationId = membership.organizationId
          ;(session.user as { role?: string }).role = membership.role
          ;(session.user as { organizationName?: string }).organizationName = membership.organization.name
        }
      }
      return session
    },
  },
}

export type AppSession = {
  user: {
    id: string
    email?: string | null
    name?: string | null
    organizationId?: string
    role?: string
    organizationName?: string
  }
}
