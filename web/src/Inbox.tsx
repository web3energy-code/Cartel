import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Send } from 'lucide-react'
import { api, nameOf, post, shortAccount } from './api'
import type { Conversation, Message, Profile } from './api'
import { Avatar } from './ui'
import { useWallet } from './wallet'

function when(iso: string) {
  const date = new Date(iso)
  const today = new Date()

  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export default function Inbox({
  openWith,
  productName,
  onClose,
  onViewSeller,
  onUnread,
}: {
  openWith: string
  productName: string
  onClose: () => void
  onViewSeller: (account: string) => void
  onUnread: (count: number) => void
}) {
  const { accountId, connect } = useWallet()
  const [active, setActive] = useState(openWith)
  const [threads, setThreads] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => setActive(openWith), [openWith])

  const loadThreads = useCallback(async () => {
    if (!accountId) return

    try {
      const result = await api<{ conversations: Conversation[]; unread: number }>(`/conversations?account=${encodeURIComponent(accountId)}`)

      setThreads(result.conversations)
      onUnread(result.unread)
    } catch {
      // keep the old list
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line
  }, [accountId])

  useEffect(() => {
    void loadThreads()

    const timer = window.setInterval(() => void loadThreads(), 10_000)

    return () => window.clearInterval(timer)
  }, [loadThreads])

  if (!accountId) {
    return (
      <div className="c-empty">
        <b>Connect your wallet to see messages</b>
        <button className="c-btn signal" onClick={connect}>
          Connect wallet
        </button>
      </div>
    )
  }

  if (active) {
    return (
      <Chat
        me={accountId}
        other={active}
        starter={active === openWith ? productName : ''}
        onBack={() => {
          setActive('')
          onClose()
          void loadThreads()
        }}
        onViewSeller={onViewSeller}
        onSent={() => void loadThreads()}
        onRead={() => void loadThreads()}
      />
    )
  }

  return (
    <>
      <section className="c-hero">
        <h1>Messages.</h1>
        <p>Ask sellers questions before you buy.</p>
      </section>

      {loading ? (
        <div className="c-empty">Loading…</div>
      ) : threads.length === 0 ? (
        <div className="c-empty">
          <b>No messages yet</b>
          <span>Open a product or a seller page and tap Message seller.</span>
        </div>
      ) : (
        <div className="c-box" style={{ padding: '4px 14px' }}>
          {threads.map((thread) => (
            <button key={thread.with} className="c-thread" onClick={() => setActive(thread.with)}>
              <Avatar profile={thread.profile} account={thread.with} size={46} />
              <div className="c-linebody">
                <b>{nameOf(thread.profile, thread.with)}</b>
                <span className="c-sub">
                  {thread.last.from === accountId ? 'You: ' : ''}
                  {thread.last.body}
                </span>
              </div>
              <div style={{ display: 'grid', gap: 4, justifyItems: 'end' }}>
                <span className="c-sub">{when(thread.last.createdAt)}</span>
                {thread.unread > 0 && (
                  <span className="c-status bad" style={{ padding: '2px 8px' }}>
                    {thread.unread}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function Chat({
  me,
  other,
  starter,
  onBack,
  onViewSeller,
  onSent,
  onRead,
}: {
  me: string
  other: string
  starter: string
  onBack: () => void
  onViewSeller: (account: string) => void
  onSent: () => void
  onRead: () => void
}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [profile, setProfile] = useState<Profile | undefined>()
  const [text, setText] = useState(starter ? `Hi, is “${starter}” still available?` : '')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const log = useRef<HTMLDivElement>(null)
  const lastCount = useRef(0)

  const load = useCallback(async () => {
    try {
      const result = await api<{ messages: Message[]; profile: Profile }>(
        `/messages?account=${encodeURIComponent(me)}&with=${encodeURIComponent(other)}`,
      )

      setMessages(result.messages)
      setProfile(result.profile)
      onRead()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the conversation.')
    }
    // eslint-disable-next-line
  }, [me, other])

  useEffect(() => {
    void load()

    const timer = window.setInterval(() => void load(), 5_000)

    return () => window.clearInterval(timer)
  }, [load])

  useEffect(() => {
    if (messages.length !== lastCount.current) {
      lastCount.current = messages.length
      log.current?.scrollTo({ top: log.current.scrollHeight })
    }
  }, [messages])

  async function send() {
    const body = text.trim()

    if (!body || sending) return

    setSending(true)
    setError('')

    try {
      await post('/messages', { from: me, to: other, body })
      setText('')
      await load()
      onSent()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send your message.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="c-chat">
      <div className="c-chat-head">
        <button className="c-back" style={{ margin: 0 }} onClick={onBack} aria-label="Back to messages">
          <ArrowLeft size={20} />
        </button>
        <button className="c-person" onClick={() => onViewSeller(other)}>
          <Avatar profile={profile} account={other} size={38} />
          <span>
            <b>{nameOf(profile, other)}</b>
            <span className="c-sub">{shortAccount(other)}</span>
          </span>
        </button>
      </div>

      <div className="c-chat-log" ref={log}>
        {messages.length === 0 && <div className="c-sub" style={{ textAlign: 'center', margin: 'auto' }}>Say hello 👋</div>}
        {messages.map((message) => (
          <div key={message.id} className={'c-bubble' + (message.from === me ? ' me' : '')}>
            {message.body}
            <small>{when(message.createdAt)}</small>
          </div>
        ))}
      </div>

      <div>
        {error && <div className="c-err" style={{ marginBottom: 6 }}>{error}</div>}
        <form
          className="c-chat-form"
          onSubmit={(event) => {
            event.preventDefault()
            void send()
          }}
        >
          <input value={text} onChange={(event) => setText(event.target.value)} maxLength={1000} placeholder="Write a message" />
          <button className="c-btn signal" type="submit" disabled={sending || !text.trim()} aria-label="Send">
            <Send size={18} />
          </button>
        </form>
      </div>
    </div>
  )
}
