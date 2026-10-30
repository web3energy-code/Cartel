import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell as BellIcon, X } from 'lucide-react'
import { api, near } from './api'
import type { Order } from './api'

export interface Alert {
  id: string
  text: string
  at: string
  read: boolean
}

const lookup = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key)

    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

const store = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage can be blocked
  }
}

// Watches your orders and sales and raises an alert when something changes.
export function useAlerts(account: string, onNew: (text: string) => void) {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const onNewRef = useRef(onNew)

  onNewRef.current = onNew

  useEffect(() => {
    if (!account) {
      setAlerts([])
      return
    }

    setAlerts(lookup<Alert[]>(`cartel-alerts-${account}`, []))

    let stopped = false
    const seenKey = `cartel-seen-${account}`

    async function check() {
      try {
        const [bought, sold] = await Promise.all([
          api<{ orders: Order[] }>(`/orders?account=${encodeURIComponent(account)}&role=buyer`),
          api<{ orders: Order[] }>(`/orders?account=${encodeURIComponent(account)}&role=seller`),
        ])

        if (stopped) return

        const firstRun = localStorage.getItem(seenKey) === null
        const seen = lookup<Record<string, string>>(seenKey, {})
        const fresh: Alert[] = []
        const label = (order: Order) => order.items[0]?.name ?? 'your order'
        const stamp = (order: Order) => `${order.status}|${order.shippedAt ? 's' : ''}`

        for (const order of sold.orders) {
          const key = `sale-${order.id}`
          const now = stamp(order)

          if (seen[key] !== now) {
            if (!firstRun) {
              if (order.status === 'in_escrow' && !order.shippedAt) fresh.push(make(key + now, `New paid order: ${label(order)} (${near(order.sellerReceivesNear)} for you). Ship it to start the clock.`))
              else if (order.status === 'released') fresh.push(make(key + now, `Payment released to you: ${near(order.sellerReceivesNear)} for ${label(order)}.`))
              else if (order.status === 'disputed') fresh.push(make(key + now, `The buyer opened a dispute on ${label(order)}.`))
            }
            seen[key] = now
          }
        }

        for (const order of bought.orders) {
          const key = `buy-${order.id}`
          const now = stamp(order)

          if (seen[key] !== now) {
            if (!firstRun) {
              if (order.shippedAt && seen[key] && !seen[key].endsWith('s') && order.status === 'in_escrow') fresh.push(make(key + now, `${label(order)} was marked as shipped.`))
              else if (order.status === 'released') fresh.push(make(key + now, `Order complete: ${label(order)}. You can now review the seller.`))
              else if (order.status === 'refunded') fresh.push(make(key + now, `You were refunded ${near(order.totalNear)} for ${label(order)}.`))
            }
            seen[key] = now
          }
        }

        store(seenKey, seen)

        if (fresh.length) {
          setAlerts((previous) => {
            const next = [...fresh, ...previous].slice(0, 30)

            store(`cartel-alerts-${account}`, next)

            return next
          })
          fresh.forEach((alert) => onNewRef.current(alert.text))
        }
      } catch {
        // try again at the next check
      }
    }

    void check()

    const timer = window.setInterval(() => void check(), 25_000)

    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [account])

  const markAllRead = useCallback(() => {
    setAlerts((previous) => {
      const next = previous.map((alert) => ({ ...alert, read: true }))

      store(`cartel-alerts-${account}`, next)

      return next
    })
  }, [account])

  return { alerts, unread: alerts.filter((alert) => !alert.read).length, markAllRead }
}

function make(id: string, text: string): Alert {
  return { id, text, at: new Date().toISOString(), read: false }
}

export function Bell({ unread, onClick }: { unread: number; onClick: () => void }) {
  return (
    <button className="c-bell" onClick={onClick} aria-label={`Notifications${unread ? `, ${unread} new` : ''}`}>
      <BellIcon size={18} />
      {unread > 0 && <span className="c-dot" style={{ top: -4, left: 'auto', right: -4 }}>{unread}</span>}
    </button>
  )
}

export function AlertsPanel({ alerts, onClose, onOpenOrders }: { alerts: Alert[]; onClose: () => void; onOpenOrders: () => void }) {
  return (
    <div className="c-sheet-back" onClick={onClose}>
      <div className="c-sheet" onClick={(event) => event.stopPropagation()} role="dialog" aria-label="Notifications">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 20 }}>Notifications</h2>
          <button className="c-link" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        {alerts.length === 0 ? (
          <div className="c-sub" style={{ padding: '18px 0' }}>Nothing yet. Order updates show up here.</div>
        ) : (
          <div style={{ display: 'grid' }}>
            {alerts.map((alert) => (
              <button key={alert.id} className="c-alert" onClick={onOpenOrders}>
                <span>{alert.text}</span>
                <small>{new Date(alert.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
