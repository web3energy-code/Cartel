import { nameOf } from './api'
import type { Profile } from './api'

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
