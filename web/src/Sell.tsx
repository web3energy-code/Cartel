import { useRef, useState } from 'react'
import { Camera, Trash2, X } from 'lucide-react'
import { API_URL, near, post } from './api'
import type { Product } from './api'
import { shrink } from './image'
import { useWallet } from './wallet'

const FALLBACK = ['Electronics', 'Fashion', 'Beauty', 'Home', 'Accessories', 'Gaming', 'Other']
const MAX_PHOTOS = 5

interface Photo {
  id: string
  blob: Blob
  preview: string
}

export default function Sell({
  categories,
  products,
  onPublished,
  onChanged,
}: {
  categories: string[]
  products: Product[]
  onPublished: () => void
  onChanged: () => void
}) {
  const { accountId, connect } = useWallet()
  const fileInput = useRef<HTMLInputElement>(null)

  const [photos, setPhotos] = useState<Photo[]>([])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [condition, setCondition] = useState('New')
  const [price, setPrice] = useState('')
  const [deliveryFee, setDeliveryFee] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [location, setLocation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Money maths in whole micro-NEAR so decimals never drift (0.1 + 0.2 stays 0.3).
  const micro = (value: string) => (/^\d*\.?\d{0,6}$/.test(value) && value !== '' && value !== '.' ? Math.round(Number(value) * 1e6) : 0)
  const totalMicro = micro(price) + micro(deliveryFee)
  const total = totalMicro > 0 ? String(totalMicro / 1e6) : ''
  const youGet = Math.floor(totalMicro * 0.9) / 1e6
  const decimalInput = (value: string) => value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1').replace(/^(\d*\.\d{6}).*$/, '$1')

  const mine = products.filter((product) => product.sellerAccount === accountId)

  async function addPhotos(files: FileList | null) {
    if (!files) return
    setError('')

    try {
      const room = MAX_PHOTOS - photos.length
      const next: Photo[] = []

      for (const file of Array.from(files).slice(0, room)) {
        const blob = await shrink(file)

        next.push({ id: Math.random().toString(36).slice(2), blob, preview: URL.createObjectURL(blob) })
      }

      setPhotos((previous) => [...previous, ...next])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that photo.')
    }

    if (fileInput.current) fileInput.current.value = ''
  }

  async function publish() {
    setError('')

    if (!accountId) return setError('Connect your NEAR wallet to list something.')
    if (photos.length === 0) return setError('Add at least one photo.')
    if (!category) return setError('Choose a category.')

    const form = new FormData()

    form.append('sellerAccount', accountId)
    form.append('name', name)
    form.append('description', description)
    form.append('category', category)
    form.append('condition', condition)
    form.append('price', total)
    form.append('deliveryFee', deliveryFee)
    form.append('quantity', quantity)
    form.append('location', location)
    photos.forEach((photo, index) => form.append('images', photo.blob, `photo-${index}.jpg`))

    setBusy(true)

    try {
      let response: Response

      try {
        response = await fetch(`${API_URL}/products`, { method: 'POST', body: form })
      } catch {
        throw new Error('Could not reach Cartel. Check your connection and try again.')
      }

      const data = await response.json().catch(() => ({}))

      if (!response.ok || data.success === false) throw new Error(data.error || 'Could not publish your listing.')

      setPhotos([])
      setName('')
      setDescription('')
      setPrice('')
      setDeliveryFee('')
      setQuantity('1')
      setLocation('')
      onPublished()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not publish your listing.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(product: Product) {
    if (!window.confirm(`Remove “${product.name}” from the market?`)) return

    try {
      await post(`/products/${product.id}/remove`, { sellerAccount: accountId })
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove the listing.')
    }
  }

  if (!accountId) {
    return (
      <div className="c-empty">
        <b>Connect your NEAR wallet to sell</b>
        <span>Your wallet account is your seller account. Payments for your sales go straight to it.</span>
        <button className="c-btn signal" onClick={connect}>
          Connect wallet
        </button>
      </div>
    )
  }

  return (
    <>
      <section className="c-hero">
        <h1>List something.</h1>
        <p>Selling as {accountId}</p>
      </section>

      <div className="c-form">
        <div className="c-field">
          <label>Photos ({photos.length}/{MAX_PHOTOS})</label>
          <div className="c-photos">
            {photos.map((photo) => (
              <div className="c-photo" key={photo.id}>
                <img src={photo.preview} alt="" />
                <button onClick={() => setPhotos((previous) => previous.filter((item) => item.id !== photo.id))} aria-label="Remove photo">
                  <X size={14} />
                </button>
              </div>
            ))}
            {photos.length < MAX_PHOTOS && (
              <button className="c-add" onClick={() => fileInput.current?.click()}>
                <Camera size={22} />
                Add
              </button>
            )}
          </div>
          <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(event) => void addPhotos(event.target.files)} />
        </div>

        <div className="c-field">
          <label>Name</label>
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="What are you selling?" />
        </div>

        <div className="c-field">
          <label>Description</label>
          <textarea
            className="c-textarea"
            rows={4}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={3000}
            placeholder="Condition, size, what is included…"
          />
        </div>

        <div className="c-warnbox" style={{ marginBottom: 0 }}>
          <b>Add your delivery fee to the price.</b> Buyers pay one total and you ship the item to their address. Fill in the item price and your delivery cost below, and Cartel adds them together.
        </div>

        <div className="c-two">
          <div className="c-field">
            <label htmlFor="item-price">Item price (NEAR)</label>
            <input id="item-price" inputMode="decimal" value={price} onChange={(event) => setPrice(decimalInput(event.target.value))} placeholder="2" />
          </div>
          <div className="c-field">
            <label htmlFor="delivery-fee">Delivery fee (NEAR)</label>
            <input id="delivery-fee" inputMode="decimal" value={deliveryFee} onChange={(event) => setDeliveryFee(decimalInput(event.target.value))} placeholder="0.5" />
          </div>
        </div>

        {total && (
          <div className="c-box" style={{ margin: 0 }}>
            <div className="c-row">
              <span>Item</span>
              <span>{near(String(micro(price) / 1e6))}</span>
            </div>
            <div className="c-row">
              <span>Delivery</span>
              <span>{near(String(micro(deliveryFee) / 1e6))}</span>
            </div>
            <div className="c-row total">
              <span>Buyers pay</span>
              <span>{near(total)}</span>
            </div>
            <div className="c-sub">You receive {near(String(youGet))} after the 10% Cartel fee.</div>
          </div>
        )}

        <div className="c-field">
          <label htmlFor="qty">Quantity</label>
          <input id="qty" inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value.replace(/\D/g, ''))} />
        </div>

        <div className="c-two">
          <div className="c-field">
            <label>Category</label>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">Choose…</option>
              {(categories.length ? categories : FALLBACK).map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>
          <div className="c-field">
            <label>Condition</label>
            <select value={condition} onChange={(event) => setCondition(event.target.value)}>
              <option>New</option>
              <option>Like new</option>
              <option>Used</option>
            </select>
          </div>
        </div>

        <div className="c-field">
          <label>Location (optional)</label>
          <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Lagos, Nigeria" />
        </div>

        {error && <div className="c-err">{error}</div>}

        <button className="c-btn signal full" disabled={busy} onClick={() => void publish()}>
          {busy ? 'Publishing…' : 'Publish listing'}
        </button>
      </div>

      {mine.length > 0 && (
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 22, marginBottom: 8 }}>Your listings</h2>
          <div className="c-box">
            {mine.map((product) => (
              <div className="c-line" key={product.id}>
                {product.images[0] ? <img src={product.images[0]} alt="" /> : <div className="c-noimg" />}
                <div className="c-linebody">
                  <b>{product.name}</b>
                  <span className="c-sub">
                    {near(product.priceNear)} · {product.quantity} left
                  </span>
                </div>
                <button className="c-link" onClick={() => void remove(product)} aria-label="Remove listing">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  )
}
