'use client'

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft, Bell, Check, CheckCheck, ChevronDown, CircleUserRound, Clock3,
  LogOut, Menu, MessageCircle, MoreHorizontal, Phone, Plus, Search, Send,
  Settings, ShieldCheck, Users, Video, X,
} from 'lucide-react'
import {
  Conversation, Message, Participant, User, createSocketUrl, signalApi,
} from '@/lib/signal-api'

type Section = 'chats' | 'calls' | 'stories' | 'settings'
type AuthMode = 'login' | 'register'
type SocketPayload = Record<string, unknown> & { type: string }

const palette = ['#dce7ff', '#ffe0d2', '#d7f4e6', '#fff0b8', '#f3d5ff']

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase()
}

function formatTime(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)
  }
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
}

function Avatar({ name, color, online, size = 'md' }: { name: string; color: string; online?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  const dimensions = size === 'lg' ? 'size-14 text-base' : size === 'sm' ? 'size-9 text-xs' : 'size-11 text-sm'
  return (
    <span className={`relative grid shrink-0 place-items-center rounded-full font-semibold text-[#34476b] ${dimensions}`} style={{ backgroundColor: color }}>
      {initials(name) || <CircleUserRound className="size-5" />}
      {online && <span className="absolute bottom-0 right-0 size-3 rounded-full border-2 border-white bg-[#38a978]" />}
    </span>
  )
}

export default function SignalApp() {
  const [mode, setMode] = useState<AuthMode>('login')
  const [identifier, setIdentifier] = useState('')
  const [otp, setOtp] = useState('123456')
  const [displayName, setDisplayName] = useState('')
  const [avatar, setAvatar] = useState(palette[0])
  const [authError, setAuthError] = useState('')
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [restoring, setRestoring] = useState(true)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [section, setSection] = useState<Section>('chats')
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [socketState, setSocketState] = useState<'connecting' | 'connected' | 'offline'>('offline')
  const [remoteTyping, setRemoteTyping] = useState('')
  const [toast, setToast] = useState('')
  const [showContacts, setShowContacts] = useState(false)
  const [groupMode, setGroupMode] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [contactQuery, setContactQuery] = useState('')
  const [contacts, setContacts] = useState<User[]>([])
  const [groupName, setGroupName] = useState('')
  const [groupMembers, setGroupMembers] = useState<string[]>([])
  const [addingMember, setAddingMember] = useState(false)
  const [mobileShowChat, setMobileShowChat] = useState(false)
  const socketRef = useRef<WebSocket | null>(null)
  const selectedRef = useRef<string | null>(null)
  const userRef = useRef<User | null>(null)
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const messageEndRef = useRef<HTMLDivElement | null>(null)

  const selected = conversations.find((conversation) => conversation.id === selectedId) || null
  const visibleConversations = conversations.filter((conversation) =>
    `${conversation.name} ${conversation.last_message || ''}`.toLowerCase().includes(query.toLowerCase()),
  )
  const myMembership = selected?.members.find((member) => member.user_id === user?.id)
  const canManageGroup = selected?.type === 'group' && myMembership?.role === 'admin'

  useEffect(() => {
    selectedRef.current = selectedId
  }, [selectedId])

  useEffect(() => {
    userRef.current = user
  }, [user])

  useEffect(() => {
    const savedToken = window.localStorage.getItem('signal_token')
    if (savedToken) setToken(savedToken)
    else setRestoring(false)
  }, [])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    async function restoreSession() {
      try {
        const [currentUser, result] = await Promise.all([
          signalApi.me(token!),
          signalApi.conversations(token!),
        ])
        if (cancelled) return
        setUser(currentUser)
        setConversations(result.conversations)
      } catch (error) {
        if (cancelled) return
        window.localStorage.removeItem('signal_token')
        setToken(null)
        setUser(null)
        setAuthError(error instanceof Error ? error.message : 'Your session has expired. Sign in again.')
      } finally {
        if (!cancelled) setRestoring(false)
      }
    }
    void restoreSession()
    return () => { cancelled = true }
  }, [token])

  useEffect(() => {
    if (!token || !user) return
    setSocketState('connecting')
    const socket = new WebSocket(createSocketUrl(token))
    socketRef.current = socket
    socket.onopen = () => setSocketState('connected')
    socket.onclose = () => setSocketState('offline')
    socket.onerror = () => setSocketState('offline')
    socket.onmessage = (event) => {
      let payload: SocketPayload
      try {
        payload = JSON.parse(event.data) as SocketPayload
      } catch {
        return
      }
      if (payload.type === 'ready') {
        setSocketState('connected')
        return
      }
      if (payload.type === 'error') {
        setToast(String(payload.detail || 'Realtime connection error'))
        return
      }
      if (payload.type === 'message.new') {
        const message = payload.message as Message
        const clientId = payload.client_id as string | null
        setConversations((items) => {
          const next = items.map((item) => item.id === message.conversation_id
            ? { ...item, last_message: message.body, last_message_at: message.created_at, unread_count: item.id === selectedRef.current || message.sender_id === userRef.current?.id ? 0 : item.unread_count + 1 }
            : item)
          return next.sort((a, b) => new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime())
        })
        if (message.conversation_id === selectedRef.current) {
          setMessages((items) => {
            const withoutOptimistic = clientId ? items.filter((item) => item.id !== clientId) : items
            if (withoutOptimistic.some((item) => item.id === message.id)) return withoutOptimistic
            return [...withoutOptimistic, message]
          })
          if (message.sender_id !== userRef.current?.id && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'receipt.read', conversation_id: message.conversation_id, message_id: message.id }))
          }
        }
        return
      }
      if (payload.type === 'message.status') {
        const messageId = String(payload.message_id)
        setMessages((items) => items.map((item) => item.id === messageId ? { ...item, status: payload.status as Message['status'], delivered_at: payload.delivered_at as string | null, read_at: payload.read_at as string | null } : item))
        return
      }
      if (payload.type === 'typing') {
        if (payload.conversation_id === selectedRef.current) {
          const isTyping = Boolean(payload.is_typing)
          setRemoteTyping(isTyping ? String(payload.display_name || 'Someone') : '')
        }
        return
      }
      if (payload.type === 'presence') {
        const personId = String(payload.user_id)
        const online = Boolean(payload.is_online)
        setContacts((items) => items.map((item) => item.id === personId ? { ...item, is_online: online, last_seen_at: String(payload.last_seen_at) } : item))
        setConversations((items) => items.map((item) => ({
          ...item,
          is_online: item.type === 'direct' && item.members.some((member) => member.user_id === personId) ? online : item.is_online,
          members: item.members.map((member) => member.user_id === personId ? { ...member, is_online: online } : member),
        })))
        return
      }
      if (payload.type === 'receipt.read') {
        const conversationId = String(payload.conversation_id)
        setMessages((items) => items.map((item) => item.conversation_id === conversationId && item.sender_id === userRef.current?.id
          ? { ...item, status: 'read', read_at: String(payload.read_at) }
          : item))
      }
    }
    return () => {
      socket.close()
      socketRef.current = null
    }
  }, [token, user])

  useEffect(() => {
    if (!token || !selectedId) {
      setMessages([])
      return
    }
    let cancelled = false
    async function loadMessages() {
      try {
        const result = await signalApi.messages(token!, selectedId!)
        if (cancelled) return
        setMessages(result.messages)
        setConversations((items) => items.map((item) => item.id === selectedId ? { ...item, unread_count: 0 } : item))
        const socket = socketRef.current
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'receipt.read', conversation_id: selectedId, message_id: null }))
        }
      } catch (error) {
        if (!cancelled) setToast(error instanceof Error ? error.message : 'Could not load messages')
      }
    }
    void loadMessages()
    setRemoteTyping('')
    return () => { cancelled = true }
  }, [token, selectedId, socketState])

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, remoteTyping])

  useEffect(() => {
    if (!showContacts || !token) return
    let cancelled = false
    const timeout = setTimeout(async () => {
      try {
        const result = await signalApi.users(token, contactQuery.trim())
        if (!cancelled) setContacts(result.users)
      } catch (error) {
        if (!cancelled) setToast(error instanceof Error ? error.message : 'Could not search contacts')
      }
    }, 180)
    return () => { cancelled = true; clearTimeout(timeout) }
  }, [contactQuery, showContacts, token])

  useEffect(() => {
    if (!toast) return
    const timeout = setTimeout(() => setToast(''), 3500)
    return () => clearTimeout(timeout)
  }, [toast])

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setAuthError('')
    try {
      const result = mode === 'login'
        ? await signalApi.login(identifier.trim(), otp)
        : await signalApi.register(identifier.trim(), otp, displayName.trim(), avatar)
      window.localStorage.setItem('signal_token', result.token)
      setUser(result.user)
      setToken(result.token)
      setRestoring(true)
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Could not sign in')
    } finally {
      setBusy(false)
    }
  }

  function logout() {
    socketRef.current?.close()
    window.localStorage.removeItem('signal_token')
    setToken(null)
    setUser(null)
    setConversations([])
    setSelectedId(null)
    setMessages([])
    setSection('chats')
    setAuthError('')
  }

  async function refreshConversations(selectId?: string) {
    if (!token) return
    const result = await signalApi.conversations(token)
    setConversations(result.conversations)
    if (selectId) setSelectedId(selectId)
  }

  async function startDirectChat(person: User) {
    if (!token) return
    try {
      const conversation = await signalApi.createDirect(token, person.id)
      await refreshConversations(conversation.id)
      setShowContacts(false)
      setContactQuery('')
      setMobileShowChat(true)
      setSection('chats')
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not start conversation')
    }
  }

  async function createGroup() {
    if (!token || !groupName.trim()) return
    try {
      const conversation = await signalApi.createGroup(token, groupName.trim(), groupMembers)
      await refreshConversations(conversation.id)
      setShowContacts(false)
      setGroupMode(false)
      setGroupName('')
      setGroupMembers([])
      setContactQuery('')
      setMobileShowChat(true)
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not create group')
    }
  }

  async function addGroupMember(person: User) {
    if (!token || !selected) return
    try {
      const updated = await signalApi.addMember(token, selected.id, person.id)
      setConversations((items) => items.map((item) => item.id === updated.id ? updated : item))
      setAddingMember(false)
      setShowContacts(false)
      setContactQuery('')
      setToast(`${person.display_name} added to the group`)
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not add member')
    }
  }

  async function removeGroupMember(member: Participant) {
    if (!token || !selected) return
    try {
      const updated = await signalApi.removeMember(token, selected.id, member.user_id)
      setConversations((items) => items.map((item) => item.id === updated.id ? updated : item))
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not remove member')
    }
  }

  function sendTyping(isTyping: boolean) {
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN && selectedId) {
      socket.send(JSON.stringify({ type: 'typing', conversation_id: selectedId, is_typing: isTyping }))
    }
  }

  async function sendMessage() {
    const body = draft.trim()
    if (!body || !selected || !user || !token) return
    const clientId = crypto.randomUUID()
    const optimistic: Message = {
      id: clientId,
      conversation_id: selected.id,
      sender_id: user.id,
      sender_name: user.display_name,
      body,
      status: 'sending',
      created_at: new Date().toISOString(),
      delivered_at: null,
      read_at: null,
    }
    setMessages((items) => [...items, optimistic])
    setDraft('')
    sendTyping(false)
    setConversations((items) => items.map((item) => item.id === selected.id
      ? { ...item, last_message: body, last_message_at: optimistic.created_at, unread_count: 0 }
      : item).sort((a, b) => new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime()))
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'message.send', conversation_id: selected.id, body, client_id: clientId }))
      return
    }
    try {
      const message = await signalApi.sendMessage(token, selected.id, body, clientId)
      setMessages((items) => items.map((item) => item.id === clientId ? message : item))
    } catch (error) {
      setMessages((items) => items.filter((item) => item.id !== clientId))
      setToast(error instanceof Error ? error.message : 'Message could not be sent')
    }
  }

  function handleDraftChange(value: string) {
    setDraft(value)
    sendTyping(Boolean(value.trim()))
    if (typingTimer.current) clearTimeout(typingTimer.current)
    typingTimer.current = setTimeout(() => sendTyping(false), 1600)
  }

  function handleComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void sendMessage()
    }
  }

  if (restoring) {
    return <main className="grid min-h-dvh place-items-center bg-[#f7f8fb] text-[#1c2433]"><div className="flex items-center gap-3 text-sm text-[#697386]"><span className="size-2 animate-pulse rounded-full bg-[#3d68bd]" />Connecting to Signal</div></main>
  }

  if (!token || !user) {
    return (
      <main className="grid min-h-dvh bg-[#f4f6f9] text-[#202738] lg:grid-cols-[1.05fr_0.95fr]">
        <section className="relative hidden overflow-hidden bg-[#284b75] px-12 py-10 text-white lg:flex lg:flex-col lg:justify-between xl:px-20">
          <div className="absolute -right-24 -top-20 size-[30rem] rounded-full border border-white/10" />
          <div className="absolute -bottom-48 -left-36 size-[34rem] rounded-full border border-white/10" />
          <div className="relative flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-white/10"><MessageCircle className="size-5" /></span><span className="text-lg font-semibold">Signal</span></div>
          <div className="relative max-w-lg pb-10"><p className="mb-5 text-xs font-semibold uppercase text-[#b8d8ed]">Private messenger</p><h1 className="text-5xl font-semibold leading-[1.08]">Say it like you mean it.</h1><p className="mt-5 max-w-md text-base leading-7 text-white/75">A private place for the conversations that matter. Connect with your people, one message at a time.</p><div className="mt-9 flex items-center gap-3 text-sm text-white/80"><ShieldCheck className="size-5 text-[#a9dfc2]" /> Demo workspace with persistent chat history</div></div>
          <p className="relative text-xs text-white/55">Signal Clone · Full-stack assignment</p>
        </section>
        <section className="flex min-h-dvh items-center justify-center px-5 py-10 sm:px-10">
          <div className="w-full max-w-[420px]">
            <div className="mb-9 flex items-center gap-3 lg:hidden"><span className="grid size-10 place-items-center rounded-xl bg-[#284b75] text-white"><MessageCircle className="size-5" /></span><span className="text-lg font-semibold">Signal</span></div>
            <p className="text-sm font-semibold text-[#43689b]">WELCOME BACK</p>
            <h2 className="mt-2 text-3xl font-semibold">{mode === 'login' ? 'Sign in to Signal' : 'Create your account'}</h2>
            <p className="mt-2 text-sm leading-6 text-[#727c8c]">Use your username or phone. This demo uses the verification code <strong className="font-semibold text-[#44536c]">123456</strong>.</p>
            <form onSubmit={submitAuth} className="mt-8 space-y-4">
              {mode === 'register' && <><label className="block text-sm font-medium text-[#505a6b]">Display name<input required minLength={1} maxLength={120} value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Your name" className="mt-2 h-12 w-full rounded-lg border border-[#d9dee7] bg-white px-4 outline-none focus:border-[#416db9] focus:ring-2 focus:ring-[#416db9]/15" /></label><fieldset><legend className="text-sm font-medium text-[#505a6b]">Profile color</legend><div className="mt-2 flex gap-2">{palette.map((color) => <button key={color} type="button" onClick={() => setAvatar(color)} aria-label={`Choose profile color ${color}`} aria-pressed={avatar === color} className={`grid size-9 place-items-center rounded-full border-2 ${avatar === color ? 'border-[#315d98]' : 'border-transparent'}`} style={{ backgroundColor: color }}><span className="sr-only">{color}</span></button>)}</div></fieldset></>}
              <label className="block text-sm font-medium text-[#505a6b]">Phone number or username<input required minLength={3} maxLength={64} value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="e.g. alex" className="mt-2 h-12 w-full rounded-lg border border-[#d9dee7] bg-white px-4 outline-none focus:border-[#416db9] focus:ring-2 focus:ring-[#416db9]/15" /></label>
              <label className="block text-sm font-medium text-[#505a6b]">Verification code<input required inputMode="numeric" minLength={6} maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} className="mt-2 h-12 w-full rounded-lg border border-[#d9dee7] bg-white px-4 tracking-[0.25em] outline-none focus:border-[#416db9] focus:ring-2 focus:ring-[#416db9]/15" /></label>
              {authError && <p role="alert" className="rounded-lg bg-[#fff0ef] px-3 py-2 text-sm text-[#a63e38]">{authError}</p>}
              <button disabled={busy} className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#315d98] font-semibold text-white transition hover:bg-[#254a7b] disabled:opacity-60">{busy ? 'Please wait…' : mode === 'login' ? 'Continue' : 'Create account'}</button>
            </form>
            <p className="mt-6 text-center text-sm text-[#727c8c]">{mode === 'login' ? 'New to Signal?' : 'Already have an account?'} <button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setAuthError('') }} className="font-semibold text-[#315d98] hover:underline">{mode === 'login' ? 'Create account' : 'Sign in'}</button></p>
            <p className="mt-6 text-center text-xs leading-5 text-[#8a93a1]">Phone verification and end-to-end encryption are mocked for this assignment.</p>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="flex h-dvh overflow-hidden bg-white text-[#202738]">
      <nav aria-label="Primary" className="hidden w-[68px] shrink-0 flex-col items-center border-r border-[#e6e9ef] bg-[#f7f8fb] py-4 md:flex">
        <button onClick={() => setSection('chats')} title="Chats" aria-label="Chats" className={`grid size-11 place-items-center rounded-xl ${section === 'chats' ? 'bg-[#dce8f8] text-[#315d98]' : 'text-[#6d7788] hover:bg-white'}`}><MessageCircle className="size-5" /></button>
        <button onClick={() => setSection('calls')} title="Calls" aria-label="Calls" className={`mt-3 grid size-11 place-items-center rounded-xl ${section === 'calls' ? 'bg-[#dce8f8] text-[#315d98]' : 'text-[#6d7788] hover:bg-white'}`}><Phone className="size-5" /></button>
        <button onClick={() => setSection('stories')} title="Stories" aria-label="Stories" className={`mt-3 grid size-11 place-items-center rounded-xl ${section === 'stories' ? 'bg-[#dce8f8] text-[#315d98]' : 'text-[#6d7788] hover:bg-white'}`}><CircleUserRound className="size-5" /></button>
        <button onClick={() => setSection('settings')} title="Settings" aria-label="Settings" className={`mt-3 grid size-11 place-items-center rounded-xl ${section === 'settings' ? 'bg-[#dce8f8] text-[#315d98]' : 'text-[#6d7788] hover:bg-white'}`}><Settings className="size-5" /></button>
        <button onClick={logout} title="Log out" aria-label="Log out" className="mt-auto grid size-11 place-items-center rounded-xl text-[#6d7788] hover:bg-white"><LogOut className="size-5" /></button>
      </nav>

      <aside className={`${mobileShowChat ? 'hidden md:flex' : 'flex'} w-full shrink-0 flex-col border-r border-[#e6e9ef] bg-[#fbfcfe] md:w-[340px] xl:w-[380px]`}>
        <header className="flex items-center justify-between px-5 pb-4 pt-5">
          <div className="flex min-w-0 items-center gap-3"><Avatar name={user.display_name} color={user.avatar} size="sm" /><div className="min-w-0"><h1 className="truncate text-lg font-semibold">{section === 'chats' ? 'Chats' : section === 'calls' ? 'Calls' : section === 'stories' ? 'Stories' : 'Settings'}</h1><p className="truncate text-xs text-[#7d8797]">{user.display_name}</p></div></div>
          <div className="flex gap-1"><button onClick={() => { setShowContacts(true); setAddingMember(false); setGroupMode(false); setGroupName(''); setGroupMembers([]) }} className="grid size-9 place-items-center rounded-full text-[#5c6678] hover:bg-[#edf1f6]" aria-label="New message" title="New message"><Plus className="size-5" /></button><button onClick={logout} className="grid size-9 place-items-center rounded-full text-[#5c6678] hover:bg-[#edf1f6] md:hidden" aria-label="Log out"><LogOut className="size-4" /></button></div>
        </header>
        {section === 'chats' ? <>
          <label className="mx-4 flex h-10 items-center gap-2 rounded-lg bg-[#f0f2f6] px-3 text-[#788395]"><Search className="size-4 shrink-0" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search conversations" className="min-w-0 flex-1 bg-transparent text-sm text-[#202738] outline-none placeholder:text-[#8791a0]" /></label>
          <div className="mt-4 flex items-center justify-between px-5"><p className="text-xs font-semibold uppercase text-[#8992a0]">All messages</p><span className={`flex items-center gap-1.5 text-[11px] ${socketState === 'connected' ? 'text-[#398664]' : 'text-[#929aa6]'}`}><span className={`size-1.5 rounded-full ${socketState === 'connected' ? 'bg-[#42a77d]' : 'bg-[#a3aab4]'}`} />{socketState === 'connected' ? 'Live' : 'Connecting'}</span></div>
          <div className="mt-2 flex-1 overflow-y-auto px-2 pb-3">
            {visibleConversations.map((conversation) => <button key={conversation.id} onClick={() => { setSelectedId(conversation.id); setMobileShowChat(true); setShowDetails(false) }} className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition ${selectedId === conversation.id ? 'bg-[#eaf0f8]' : 'hover:bg-[#f1f3f7]'}`}>
              <Avatar name={conversation.name} color={conversation.avatar} online={conversation.is_online} />
              <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold">{conversation.name}</span><time className="shrink-0 text-[11px] text-[#8992a0]">{formatTime(conversation.last_message_at)}</time></span><span className="mt-1 flex items-center justify-between gap-2"><span className="truncate text-xs text-[#778192]">{conversation.last_message || (conversation.type === 'group' ? 'Group created' : 'Start a conversation')}</span>{conversation.unread_count > 0 && <span className="grid min-w-5 place-items-center rounded-full bg-[#3f6eaa] px-1.5 py-0.5 text-[10px] font-semibold text-white">{conversation.unread_count}</span>}</span></span>
            </button>)}
            {visibleConversations.length === 0 && <div className="px-5 py-10 text-center text-sm text-[#828c9b]">{query ? 'No matching conversations' : 'No conversations yet. Start one with +.'}</div>}
          </div>
          <footer className="hidden items-center gap-2 border-t border-[#e8ebf0] px-4 py-3 md:flex"><ShieldCheck className="size-4 text-[#46856e]" /><span className="text-xs text-[#7d8795]">Private by design</span><button onClick={() => setSection('settings')} className="ml-auto text-xs font-medium text-[#52627a] hover:text-[#315d98]">Preferences</button></footer>
        </> : <SectionPlaceholder section={section} onBack={() => setSection('chats')} />}
      </aside>

      <section className={`${mobileShowChat ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col bg-white`}>
        {section !== 'chats' ? <div className="grid flex-1 place-items-center text-sm text-[#8992a0]">Choose Chats to return to your conversations.</div> : selected ? <>
          <header className="flex h-[68px] shrink-0 items-center gap-3 border-b border-[#e8ebf0] px-4 sm:px-6">
            <button onClick={() => setMobileShowChat(false)} className="grid size-9 place-items-center rounded-full text-[#687487] hover:bg-[#f1f3f7] md:hidden" aria-label="Back to conversations"><ArrowLeft className="size-5" /></button>
            <Avatar name={selected.name} color={selected.avatar} online={selected.is_online} size="sm" />
            <button onClick={() => selected.type === 'group' && setShowDetails(true)} className="min-w-0 flex-1 text-left" aria-label={selected.type === 'group' ? 'View group details' : undefined}>
              <span className="block truncate text-sm font-semibold">{selected.name}</span>
              <span className="block truncate text-xs text-[#7d8797]">{selected.type === 'group' ? `${selected.members.length} members` : selected.is_online ? 'online' : 'Signal conversation'}</span>
            </button>
            <button className="hidden size-9 place-items-center rounded-full text-[#687487] hover:bg-[#f1f3f7] sm:grid" aria-label="Voice call (coming soon)" title="Voice call coming soon"><Phone className="size-[18px]" /></button>
            <button className="hidden size-9 place-items-center rounded-full text-[#687487] hover:bg-[#f1f3f7] sm:grid" aria-label="Video call (coming soon)" title="Video call coming soon"><Video className="size-[18px]" /></button>
            <button onClick={() => setShowDetails(true)} className="grid size-9 place-items-center rounded-full text-[#687487] hover:bg-[#f1f3f7]" aria-label="Conversation details"><MoreHorizontal className="size-5" /></button>
          </header>
          <div className="flex-1 overflow-y-auto bg-[#f8f9fb] px-4 py-6 sm:px-8">
            <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-end gap-3">
              <div className="mb-4 flex justify-center"><span className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[11px] text-[#7d8795] shadow-sm"><ShieldCheck className="size-3.5 text-[#43856d]" />Messages are stored in this demo database</span></div>
              {messages.map((message) => {
                const mine = message.sender_id === user.id
                return <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <article className={`max-w-[min(78%,34rem)] rounded-2xl px-4 py-2.5 shadow-[0_1px_2px_rgba(20,35,60,0.05)] ${mine ? 'rounded-br-md bg-[#dce9f8]' : 'rounded-bl-md border border-[#e9ecf1] bg-white'}`}>
                    {selected.type === 'group' && !mine && <p className="mb-1 text-[11px] font-semibold text-[#416a9e]">{message.sender_name}</p>}
                    <p className="whitespace-pre-wrap break-words text-sm leading-6 text-[#273247]">{message.body}</p>
                    <div className={`mt-1 flex items-center justify-end gap-1.5 text-[10px] text-[#8490a0]`}><time>{formatTime(message.created_at)}</time>{mine && <MessageStatus status={message.status} />}</div>
                  </article>
                </div>
              })}
              {remoteTyping && <div className="flex items-center gap-2 text-xs text-[#748095]"><span className="flex gap-1"><i className="size-1.5 animate-bounce rounded-full bg-[#8594a7]" /><i className="size-1.5 animate-bounce rounded-full bg-[#8594a7] [animation-delay:120ms]" /><i className="size-1.5 animate-bounce rounded-full bg-[#8594a7] [animation-delay:240ms]" /></span>{remoteTyping} is typing</div>}
              <div ref={messageEndRef} />
            </div>
          </div>
          <div className="shrink-0 border-t border-[#e8ebf0] bg-white px-3 py-3 sm:px-6 sm:py-4">
            <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-[#e1e5eb] bg-white p-2 shadow-[0_3px_12px_rgba(31,47,72,0.04)] focus-within:border-[#9eb5d5]">
              <textarea value={draft} onChange={(event) => handleDraftChange(event.target.value)} onKeyDown={handleComposerKey} rows={1} placeholder="Write a message" aria-label="Write a message" className="max-h-32 min-h-10 flex-1 resize-y bg-transparent px-2 py-2 text-sm leading-6 outline-none placeholder:text-[#929baa]" />
              <button onClick={() => void sendMessage()} disabled={!draft.trim()} aria-label="Send message" title="Send message" className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#315d98] text-white transition hover:bg-[#254a7b] disabled:bg-[#dce2ea] disabled:text-[#8d97a5]"><Send className="size-4" /></button>
            </div>
            <p className="mt-1.5 text-center text-[10px] text-[#a0a8b3]">Enter to send · Shift + Enter for a new line</p>
          </div>
        </> : <div className="hidden flex-1 flex-col items-center justify-center bg-[#f8f9fb] text-center md:flex"><div className="grid size-16 place-items-center rounded-2xl bg-[#e8eef7] text-[#42689b]"><MessageCircle className="size-7" /></div><h2 className="mt-5 text-lg font-semibold">Your messages, your people</h2><p className="mt-2 max-w-xs text-sm leading-6 text-[#7c8796]">Choose a conversation or start a new chat to pick up where you left off.</p><button onClick={() => setShowContacts(true)} className="mt-5 flex items-center gap-2 rounded-lg bg-[#315d98] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#254a7b]"><Plus className="size-4" />New message</button></div>}
      </section>

      {showDetails && selected && <>
        <button className="fixed inset-0 z-30 bg-[#17243a]/20 md:hidden" onClick={() => setShowDetails(false)} aria-label="Close details" />
        <aside className="fixed inset-y-0 right-0 z-40 w-full max-w-[360px] overflow-y-auto border-l border-[#e4e8ef] bg-white p-5 shadow-xl md:static md:z-0 md:shadow-none">
          <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">{selected.type === 'group' ? 'Group details' : 'Contact details'}</h2><button onClick={() => setShowDetails(false)} className="grid size-9 place-items-center rounded-full text-[#687487] hover:bg-[#f1f3f7]" aria-label="Close details"><X className="size-4" /></button></div>
          <div className="mt-8 flex flex-col items-center text-center"><Avatar name={selected.name} color={selected.avatar} size="lg" online={selected.is_online} /><h3 className="mt-3 text-lg font-semibold">{selected.name}</h3><p className="mt-1 text-sm text-[#7d8797]">{selected.type === 'group' ? `${selected.members.length} members` : selected.is_online ? 'Online now' : 'Signal user'}</p></div>
          <div className="my-6 grid grid-cols-2 gap-2"><button className="flex items-center justify-center gap-2 rounded-lg bg-[#f2f5f9] px-3 py-2.5 text-sm text-[#4c5d76]" title="Voice calling coming soon"><Phone className="size-4" />Call</button><button className="flex items-center justify-center gap-2 rounded-lg bg-[#f2f5f9] px-3 py-2.5 text-sm text-[#4c5d76]" title="Video calling coming soon"><Video className="size-4" />Video</button></div>
          {selected.type === 'group' && <section className="border-t border-[#edf0f4] pt-5"><div className="flex items-center justify-between"><h4 className="text-sm font-semibold">Members</h4>{canManageGroup && <button onClick={() => { setAddingMember(true); setShowContacts(true); setContactQuery('') }} className="grid size-8 place-items-center rounded-lg text-[#41699c] hover:bg-[#eff3f8]" aria-label="Add group member" title="Add member"><Plus className="size-4" /></button>}</div><div className="mt-3 space-y-1">{selected.members.map((member) => <div key={member.user_id} className="flex items-center gap-3 rounded-lg px-2 py-2"><Avatar name={member.display_name} color={member.avatar} online={member.is_online} size="sm" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{member.display_name}{member.user_id === user.id ? ' (you)' : ''}</p><p className="text-xs text-[#858e9d]">{member.role === 'admin' ? 'Admin' : member.is_online ? 'Online' : member.identifier}</p></div>{canManageGroup && member.user_id !== user.id && <button onClick={() => void removeGroupMember(member)} className="grid size-8 place-items-center rounded-lg text-[#8b5360] hover:bg-[#fff0f0]" title={`Remove ${member.display_name}`} aria-label={`Remove ${member.display_name}`}><X className="size-4" /></button>}</div>)}</div></section>}
          <div className="mt-6 border-t border-[#edf0f4] pt-5"><h4 className="text-sm font-semibold">Privacy</h4><p className="mt-2 text-xs leading-5 text-[#818b9a]">End-to-end encryption is not implemented in this assignment demo.</p></div>
        </aside>
      </>}

      {showContacts && <div className="fixed inset-0 z-50 grid place-items-center bg-[#17243a]/35 p-3 sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowContacts(false) }}>
        <section role="dialog" aria-modal="true" aria-labelledby="contacts-title" className="flex max-h-[min(680px,92dvh)] w-full max-w-[460px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
          <header className="flex items-center justify-between border-b border-[#edf0f4] px-5 py-4"><div><h2 id="contacts-title" className="font-semibold">{addingMember ? 'Add group member' : groupMode ? 'Create a group' : 'New conversation'}</h2><p className="mt-0.5 text-xs text-[#858e9d]">Find people by name or username</p></div><button onClick={() => { setShowContacts(false); setAddingMember(false); setGroupMode(false); setGroupName(''); setGroupMembers([]) }} className="grid size-9 place-items-center rounded-full text-[#687487] hover:bg-[#f1f3f7]" aria-label="Close"><X className="size-4" /></button></header>
          <label className="mx-4 mt-4 flex h-10 items-center gap-2 rounded-lg bg-[#f0f2f6] px-3 text-[#788395]"><Search className="size-4" /><input autoFocus value={contactQuery} onChange={(event) => setContactQuery(event.target.value)} placeholder="Name or username" className="min-w-0 flex-1 bg-transparent text-sm text-[#202738] outline-none" /></label>
          {!addingMember && <div className="mx-4 mt-4 flex rounded-lg bg-[#f0f2f6] p-1"><button onClick={() => { setGroupMode(false); setGroupMembers([]) }} className={`flex-1 rounded-md py-2 text-xs font-semibold ${!groupMode ? 'bg-white text-[#315d98] shadow-sm' : 'text-[#737e8e]'}`}>Message</button><button onClick={() => setGroupMode(true)} className={`flex-1 rounded-md py-2 text-xs font-semibold ${groupMode ? 'bg-white text-[#315d98] shadow-sm' : 'text-[#737e8e]'}`}>Group</button></div>}
          {!addingMember && groupMode && <input required value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="Group name" maxLength={120} className="mx-4 mt-3 h-10 w-[calc(100%-2rem)] rounded-lg border border-[#e2e6ec] px-3 text-sm outline-none focus:border-[#7795bd]" />}
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {!addingMember && groupMode && groupName.trim() && <p className="px-2 pb-2 text-xs text-[#738095]">Select people to add to {groupName}.</p>}
            {contacts.filter((person) => !addingMember || !selected?.members.some((member) => member.user_id === person.id)).map((person) => {
              const checked = groupMembers.includes(person.id)
              return <div key={person.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-[#f6f8fa]">
                <Avatar name={person.display_name} color={person.avatar} online={person.is_online} size="sm" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{person.display_name}</p><p className="truncate text-xs text-[#858e9d]">@{person.identifier}{person.is_online ? ' · online' : ''}</p></div>
                {addingMember ? <button onClick={() => void addGroupMember(person)} className="rounded-lg bg-[#315d98] px-3 py-1.5 text-xs font-semibold text-white">Add</button> : groupMode ? <button onClick={() => setGroupMembers((items) => checked ? items.filter((id) => id !== person.id) : [...items, person.id])} className={`grid size-7 place-items-center rounded-md border ${checked ? 'border-[#315d98] bg-[#315d98] text-white' : 'border-[#ccd3de] text-transparent'}`} aria-label={`${checked ? 'Remove' : 'Select'} ${person.display_name}`}><Check className="size-4" /></button> : <button onClick={() => void startDirectChat(person)} className="rounded-lg border border-[#dce2ea] px-3 py-1.5 text-xs font-semibold text-[#516078] hover:bg-white">Message</button>}
              </div>
            })}
            {contacts.length === 0 && <p className="px-3 py-8 text-center text-sm text-[#8791a0]">No people found.</p>}
          </div>
          {!addingMember && groupMode && <footer className="flex items-center justify-between border-t border-[#edf0f4] px-5 py-3"><span className="text-xs text-[#778294]">{groupMembers.length} selected</span><button disabled={!groupName.trim() || !groupMembers.length} onClick={() => void createGroup()} className="rounded-lg bg-[#315d98] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#c9d2df]">Create group</button></footer>}
        </section>
      </div>}
      {toast && <div role="status" className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-lg bg-[#26364e] px-4 py-3 text-sm text-white shadow-xl">{toast}</div>}
    </main>
  )
}

function MessageStatus({ status }: { status: Message['status'] }) {
  if (status === 'sending') return <Clock3 className="size-3" />
  if (status === 'read' || status === 'delivered') return <CheckCheck className={`size-3 ${status === 'read' ? 'text-[#3970ad]' : ''}`} />
  return <Check className="size-3" />
}

function SectionPlaceholder({ section, onBack }: { section: Section; onBack: () => void }) {
  const title = section === 'calls' ? 'Calls' : section === 'stories' ? 'Stories' : 'Settings'
  return <div className="flex flex-1 flex-col px-5 py-6"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">{title}</h2><button onClick={onBack} className="grid size-9 place-items-center rounded-lg text-[#687487] hover:bg-[#f1f3f7]" aria-label="Back to chats"><Menu className="size-4" /></button></div><div className="mt-8 rounded-xl border border-[#e8ebf0] bg-white p-5"><div className="grid size-10 place-items-center rounded-lg bg-[#edf2f8] text-[#526d92]">{section === 'calls' ? <Phone className="size-5" /> : section === 'stories' ? <CircleUserRound className="size-5" /> : <Settings className="size-5" />}</div><h3 className="mt-4 text-sm font-semibold">{section === 'settings' ? 'Preferences' : `${title} are coming soon`}</h3><p className="mt-2 text-sm leading-6 text-[#7d8797]">{section === 'settings' ? 'Privacy, notifications, and appearance controls will be available here.' : 'This area is a placeholder for the assignment. Messaging and groups are ready to use.'}</p></div><button onClick={onBack} className="mt-auto rounded-lg bg-[#315d98] px-4 py-2.5 text-sm font-semibold text-white">Return to chats</button></div>
}
