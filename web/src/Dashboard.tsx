import { near } from './api'
import type { Order } from './api'

const num = (value: string) => Number(value) || 0

// Seller dashboard, worked out from the seller's own orders.
export default function Dashboard({ sales }: { sales: Order[] }) {
  const paid = sales.filter((order) => ['in_escrow', 'releasing', 'released', 'disputed'].includes(order.status))
  const earned = sales.filter((order) => order.status === 'released').reduce((sum, order) => sum + num(order.sellerReceivesNear), 0)
  const held = sales.filter((order) => order.status === 'in_escrow' || order.status === 'releasing').reduce((sum, order) => sum + num(order.sellerReceivesNear), 0)
  const disputes = sales.filter((order) => order.status === 'disputed').length
  const toShip = sales.filter((order) => order.status === 'in_escrow' && !order.shippedAt).length

  // Sales over the last 7 days (by payment date).
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date()

    date.setHours(0, 0, 0, 0)
    date.setDate(date.getDate() - (6 - index))

    return { date, total: 0 }
  })

  for (const order of paid) {
    if (!order.paidAt) continue

    const paidDay = new Date(order.paidAt)

    paidDay.setHours(0, 0, 0, 0)

    const slot = days.find((day) => day.date.getTime() === paidDay.getTime())

    if (slot) slot.total += num(order.sellerReceivesNear)
  }

  const peak = Math.max(...days.map((day) => day.total), 0.0001)

  // Best sellers by units.
  const units = new Map<string, number>()

  for (const order of paid) for (const item of order.items) units.set(item.name, (units.get(item.name) ?? 0) + item.quantity)

  const top = Array.from(units.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3)

  return (
    <div className="c-dash">
      <div className="c-tiles">
        <div className="c-tile big">
          <span>Earned</span>
          <b>{near(String(earned))}</b>
          <small>after the 10% fee</small>
        </div>
        <div className="c-tile">
          <span>Held in escrow</span>
          <b>{near(String(held))}</b>
          <small>pays out when delivered</small>
        </div>
        <div className="c-tile">
          <span>Orders</span>
          <b>{paid.length}</b>
          <small>{toShip > 0 ? `${toShip} to ship` : 'none waiting'}</small>
        </div>
        <div className="c-tile">
          <span>Disputes</span>
          <b>{disputes}</b>
          <small>{disputes ? 'needs attention' : 'all clear'}</small>
        </div>
      </div>

      <div className="c-box" style={{ margin: 0 }}>
        <div className="c-sub" style={{ marginBottom: 8 }}>Sales, last 7 days (NEAR)</div>
        <div className="c-bars" role="img" aria-label="Sales per day for the last 7 days">
          {days.map((day) => (
            <div key={day.date.toISOString()} className="c-barcol">
              <span className="c-barval">{day.total ? Math.round(day.total * 100) / 100 : ''}</span>
              <i style={{ height: `${Math.max(3, (day.total / peak) * 70)}px` }} className={day.total ? 'on' : ''} />
              <small>{day.date.toLocaleDateString([], { weekday: 'narrow' })}</small>
            </div>
          ))}
        </div>
      </div>

      {top.length > 0 && (
        <div className="c-box" style={{ margin: 0 }}>
          <div className="c-sub" style={{ marginBottom: 4 }}>Best sellers</div>
          {top.map(([name, count]) => (
            <div className="c-row" key={name}>
              <span>{name}</span>
              <b>{count} sold</b>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
