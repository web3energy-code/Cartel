import { nameOf } from './api'
import type { Order, Profile } from './api'

export function Avatar({ profile, account, size = 44 }: { profile?: Profile | null; account: string; size?: number }) {
  const label = nameOf(profile, account).replace('@', '').charAt(0).toUpperCase() || '?'

  return profile?.avatarUrl ? (
    <img className="c-avatar" src={profile.avatarUrl} alt="" style={{ width: size, height: size }} />
  ) : (
    <span className="c-avatar" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {label}
    </span>
  )
}

export function Stars({ value, size = 15 }: { value: number; size?: number }) {
  return (
    <span className="c-stars" style={{ fontSize: size }} aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <i key={star} className={star <= Math.round(value) ? 'on' : ''}>
          ★
        </i>
      ))}
    </span>
  )
}

export function StarPicker({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <span className="c-stars pick" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((star) => (
        <button key={star} type="button" className={star <= value ? 'on' : ''} onClick={() => onChange(star)} aria-label={`${star} stars`}>
          ★
        </button>
      ))}
    </span>
  )
}

// Order progress: Ordered → Paid → Shipped → Completed (or Disputed / Refunded / Cancelled).
export function Timeline({ order }: { order: Order }) {
  const status = order.status
  let steps: Array<{ label: string; at: string | null; bad?: boolean }>

  if (status === 'cancelled') {
    steps = [
      { label: 'Ordered', at: order.createdAt },
      { label: 'Cancelled', at: order.createdAt, bad: true },
    ]
  } else {
    const last =
      status === 'disputed'
        ? { label: 'Disputed', at: new Date().toISOString(), bad: true }
        : status === 'refunded'
          ? { label: 'Refunded', at: order.releasedAt ?? new Date().toISOString(), bad: true }
          : { label: 'Completed', at: order.releasedAt }

    steps = [
      { label: 'Ordered', at: order.createdAt },
      { label: 'Paid', at: order.paidAt },
      { label: 'Shipped', at: order.shippedAt },
      last,
    ]
  }

  const firstOpen = steps.findIndex((step) => !step.at)

  return (
    <ol className="c-timeline" style={{ gridTemplateColumns: `repeat(${steps.length}, 1fr)` }} aria-label="Order progress">
      {steps.map((step, index) => {
        const state = step.bad ? 'bad' : step.at ? 'done' : index === firstOpen ? 'now' : ''

        return (
          <li key={step.label} className={'c-step ' + state}>
            <i>{state === 'done' ? '✓' : state === 'bad' ? '!' : ''}</i>
            <b>{step.label}</b>
            <span>{step.at && !step.bad ? new Date(step.at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ' '}</span>
          </li>
        )
      })}
    </ol>
  )
}
