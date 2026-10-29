import { useEffect, useRef, useState } from 'react'
import { Camera } from 'lucide-react'
import { API_URL, api, shortAccount } from './api'
import type { Profile as ProfileData } from './api'
import { shrink } from './image'
import { Avatar } from './ui'
import { useWallet } from './wallet'

export default function Profile({ onSaved, onViewPublic }: { onSaved: (profile: ProfileData) => void; onViewPublic: (account: string) => void }) {
  const { accountId, connect, disconnect } = useWallet()
  const fileInput = useRef<HTMLInputElement>(null)

  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [location, setLocation] = useState('')
  const [avatar, setAvatar] = useState<Blob | null>(null)
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!accountId) return

    api<{ profile: ProfileData }>(`/profiles/${encodeURIComponent(accountId)}`)
      .then(({ profile }) => {
        setProfile(profile)
        setUsername(profile.username ?? '')
        setDisplayName(profile.displayName ?? '')
        setBio(profile.bio)
        setLocation(profile.location)
      })
      .catch(() => undefined)
  }, [accountId])

  if (!accountId) {
    return (
      <div className="c-empty">
        <b>Connect your NEAR wallet</b>
        <span>Your wallet is your account. Connect it to set up your profile, message sellers and leave reviews.</span>
        <button className="c-btn signal" onClick={connect}>
          Connect wallet
        </button>
      </div>
    )
  }

  async function pick(files: FileList | null) {
    const file = files?.[0]

    if (!file) return

    try {
      const blob = await shrink(file, 512)

      setAvatar(blob)
      setPreview(URL.createObjectURL(blob))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that photo.')
    }
  }

  async function save() {
    setError('')
    setSaved(false)
    setBusy(true)

    try {
      const form = new FormData()

      form.append('account', accountId)
      form.append('username', username)
      form.append('displayName', displayName)
      form.append('bio', bio)
      form.append('location', location)
      if (avatar) form.append('avatar', avatar, 'avatar.jpg')

      let response: Response

      try {
        response = await fetch(`${API_URL}/profiles`, { method: 'POST', body: form })
      } catch {
        throw new Error('Could not reach Cartel. Check your connection and try again.')
      }

      const data = await response.json().catch(() => ({}))

      if (!response.ok || data.success === false) throw new Error(data.error || 'Could not save your profile.')

      setProfile(data.profile)
      setAvatar(null)
      setPreview('')
      setSaved(true)
      onSaved(data.profile)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your profile.')
    } finally {
      setBusy(false)
    }
  }

  const shown: ProfileData | null = preview && profile ? { ...profile, avatarUrl: preview } : profile

  return (
    <>
      <section className="c-hero">
        <h1>Your profile.</h1>
        <p>This is how buyers and sellers see you. Wallet: {shortAccount(accountId)}</p>
      </section>

      <div className="c-form">
        <div className="c-avatar-edit">
          <Avatar profile={shown} account={accountId} size={76} />
          <div style={{ display: 'grid', gap: 6 }}>
            <button className="c-btn ghost" onClick={() => fileInput.current?.click()}>
              <Camera size={16} /> Change photo
            </button>
          </div>
          <input ref={fileInput} type="file" accept="image/*" hidden onChange={(event) => void pick(event.target.files)} />
        </div>

        <div className="c-field">
          <label>Username</label>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
            maxLength={20}
            placeholder="treasure_ng"
            autoCapitalize="none"
          />
        </div>

        <div className="c-field">
          <label>Display name</label>
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={40} placeholder="Treasure" />
        </div>

        <div className="c-field">
          <label>Bio</label>
          <textarea className="c-textarea" rows={3} value={bio} onChange={(event) => setBio(event.target.value)} maxLength={300} placeholder="Tell people what you sell or what you like." />
        </div>

        <div className="c-field">
          <label>Location</label>
          <input value={location} onChange={(event) => setLocation(event.target.value)} maxLength={60} placeholder="Lagos, Nigeria" />
        </div>

        {error && <div className="c-err">{error}</div>}
        {saved && <div className="c-info-msg">Profile saved.</div>}

        <button className="c-btn signal full" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save profile'}
        </button>

        <button className="c-btn ghost full" onClick={() => onViewPublic(accountId)}>
          View my public page
        </button>

        <button className="c-link" onClick={() => void disconnect()}>
          Disconnect wallet
        </button>
      </div>
    </>
  )
}
