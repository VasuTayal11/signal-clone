export type User = {
  id: string
  identifier: string
  display_name: string
  avatar: string
  last_seen_at: string
  is_online: boolean
}

export type Participant = {
  user_id: string
  display_name: string
  identifier: string
  avatar: string
  role: 'admin' | 'member'
  is_online: boolean
}

export type Conversation = {
  id: string
  type: 'direct' | 'group'
  name: string
  avatar: string
  last_message: string | null
  last_message_at: string | null
  unread_count: number
  is_online: boolean
  members: Participant[]
  created_at?: string
  created_by_id?: string
}

export type Message = {
  id: string
  conversation_id: string
  sender_id: string
  sender_name: string
  body: string
  status: 'sending' | 'sent' | 'delivered' | 'read'
  created_at: string
  delivered_at: string | null
  read_at: string | null
}

export type AuthResponse = { token: string; user: User }
export type SocketEvent = Record<string, unknown> & { type: string }

const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')

async function request<T>(path: string, token?: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
    cache: 'no-store',
  })
  const result = await response.json().catch(() => null) as { detail?: string } | null
  if (!response.ok) {
    throw new Error(result?.detail || `Request failed (${response.status})`)
  }
  return result as T
}

export const signalApi = {
  login: (identifier: string, otp: string) =>
    request<AuthResponse>('/api/auth/login', undefined, {
      method: 'POST',
      body: JSON.stringify({ identifier, otp }),
    }),
  register: (identifier: string, otp: string, display_name: string, avatar: string) =>
    request<AuthResponse>('/api/auth/register', undefined, {
      method: 'POST',
      body: JSON.stringify({ identifier, otp, display_name, avatar }),
    }),
  me: (token: string) => request<User>('/api/auth/me', token),
  conversations: (token: string) => request<{ conversations: Conversation[] }>('/api/conversations', token),
  messages: (token: string, conversationId: string) =>
    request<{ messages: Message[] }>(`/api/conversations/${conversationId}/messages`, token),
  users: (token: string, query: string) =>
    request<{ users: User[] }>(`/api/users?q=${encodeURIComponent(query)}`, token),
  createDirect: (token: string, userId: string) =>
    request<Conversation>('/api/conversations', token, {
      method: 'POST',
      body: JSON.stringify({ type: 'direct', user_id: userId }),
    }),
  createGroup: (token: string, name: string, memberIds: string[]) =>
    request<Conversation>('/api/conversations', token, {
      method: 'POST',
      body: JSON.stringify({ type: 'group', name, member_ids: memberIds }),
    }),
  addMember: (token: string, conversationId: string, userId: string) =>
    request<Conversation>(`/api/conversations/${conversationId}/participants`, token, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    }),
  removeMember: (token: string, conversationId: string, userId: string) =>
    request<Conversation>(`/api/conversations/${conversationId}/participants/${userId}`, token, {
      method: 'DELETE',
    }),
  sendMessage: (token: string, conversationId: string, body: string, clientId: string) =>
    request<Message>(`/api/conversations/${conversationId}/messages`, token, {
      method: 'POST',
      body: JSON.stringify({ body, client_id: clientId }),
    }),
}

export function createSocketUrl(token: string): string {
  const url = new URL(API_URL)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = '/ws'
  url.search = new URLSearchParams({ token }).toString()
  return url.toString()
}
