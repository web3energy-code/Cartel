import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, Minus, Package, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { api, explorerTx, near, post, shortAccount } from './api'
import type { Config, Delivery, Order, Product } from './api'
import Dashboard from './Dashboard'
import { StarPicker, Stars, Timeline } from './ui'
import { useWallet } from './wallet'

type Tab = 'cart' | 'orders' | 'sales'

const PENDING_KEY = 'cartel-pending-order'
const DELIVERY_KEY = 'cartel-delivery'

const EMPTY_DELIVERY: Delivery = { name: '', phone: '', address: '', city: '', state: '', country: '', notes: '' }

function savedDelivery(): Delivery {
  try {
    return { ...EMPTY_DELIVERY, ...JSON.parse(localStorage.getItem(DELIVERY_KEY) || '{}') }
  } catch {
    return EMPTY_DELIVERY
  }
}

const LABELS: Record<string, string> = {
  awaiting_payment: 'Awaiting payment',
  in_escrow: 'Paid · in escrow',
  releasing: 'Releasing funds',
  released: 'Completed',
  disputed: 'Disputed',
  refunded: 'Refunded',
  cancelled: 'Cancelled',
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

function remember(orderId: string) {
  try {
    localStorage.setItem(PENDING_KEY, orderId)
  } catch {
    // ignore
  }
}

function recall(): string {
  try {
    return localStorage.getItem(PENDING_KEY) || ''
  } catch {
    return ''
  }
}

function forget() {
  try {
    localStorage.removeItem(PENDING_KEY)
  } catch {
    // ignore
  }
}

function countdown(iso: string | null) {
  if (!iso) return ''

  const ms = new Date(iso).getTime() - Date.now()

  if (ms <= 0) return 'any moment now'

  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.floor((ms % 3_600_000) / 60_000)

  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

export default function Checkout({
  products,
  cart,
  config,
  returnedTx,
  onReturnedTxHandled,
  onChangeQuantity,
  onRemove,
  onItemsPaid,
  onBrowse,
  onOpenProduct,
  onStockChanged,
}: {
  products: Product[]
  cart: Record<string, number>
  config: Config | null
  returnedTx: string
  onReturnedTxHandled: () => void
  onChangeQuantity: (id: string, amount: number) => void
  onRemove: (id: string) => void
  onItemsPaid: (ids: string[]) => void
  onBrowse: () => void
  onOpenProduct: (id: string) => void
  onStockChanged: () => void
}) {
  const { accountId, connect, sendNear } = useWallet()

  const [tab, setTab] = useState<Tab>('cart')
  const [orders, setOrders] = useState<Order[]>([])
  const [sales, setSales] = useState<Order[]>([])
  const [delivery, setDelivery] = useState<Delivery>(savedDelivery)
  const [reviewed, setReviewed] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const handledReturn = useRef('')

  const lines = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, quantity]) => ({ product: products.find((product) => product.id === id), quantity }))
        .filter((line): line is { product: Product; quantity: number } => !!line.product),
    [cart, products],
  )

  const subtotal = lines.reduce((sum, line) => sum + Number(line.product.priceNear) * line.quantity, 0)
  const sellers = new Set(lines.map((line) => line.product.sellerAccount)).size
  const ownItem = lines.some((line) => line.product.sellerAccount === accountId)

  const refresh = useCallback(async () => {
    if (!accountId) return

    setLoading(true)

    try {
      api<{ reviewed: Array<{ orderId: string; rating: number }> }>(`/reviews/mine?account=${encodeURIComponent(accountId)}`)
        .then((result) => setReviewed(Object.fromEntries(result.reviewed.map((item) => [item.orderId, item.rating]))))
        .catch(() => undefined)

      const [bought, sold] = await Promise.all([
        api<{ orders: Order[] }>(`/orders?account=${encodeURIComponent(accountId)}&role=buyer`),
        api<{ orders: Order[] }>(`/orders?account=${encodeURIComponent(accountId)}&role=seller`),
      ])

      setOrders(bought.orders)
      setSales(sold.orders)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your orders.')
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Ask the server to confirm the payment. The network can need a few seconds to finish it.
  const verify = useCallback(
    async (orderId: string, txHash: string) => {
      setBusy(orderId)
      setError('')
      setMessage('Confirming your payment on NEAR…')

      try {
        for (let attempt = 0; attempt < 12; attempt++) {
          const result = await post<{ order?: Order; pending?: boolean }>(`/orders/${orderId}/verify`, {
            buyerAccount: accountId,
            txHash,
          })

          if (result.order) {
            setMessage('Payment confirmed. Your funds are in escrow.')
            forget()
            onStockChanged()
            await refresh()
            setTab('orders')
            return
          }

          await sleep(2500)
        }

        setError('The network is slow to confirm. Open My orders in a minute and tap “I have paid” again.')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not confirm the payment.')
        setMessage('')
      } finally {
        setBusy('')
      }
    },
    [accountId, refresh, onStockChanged],
  )

  // Back from a wallet that left the page to approve the payment.
  useEffect(() => {
    if (!returnedTx || !accountId || handledReturn.current === returnedTx) return

    const orderId = recall()

    handledReturn.current = returnedTx
    onReturnedTxHandled()

    if (orderId) {
      setTab('orders')
      void verify(orderId, returnedTx)
    }
    // eslint-disable-next-line
  }, [returnedTx, accountId])

  async function pay(order: Order) {
    setError('')
    setMessage('')

    // A second payment would send your NEAR twice. Make the buyer stop and think first.
    let attempted = false

    try {
      attempted = localStorage.getItem(`cartel-attempt-${order.id}`) === '1'
    } catch {
      // ignore
    }

    if (
      attempted &&
      !window.confirm('You already tried to pay this order. If your wallet shows the payment as sent, do NOT pay again: tap “I already paid” and paste the transaction hash. Pay again anyway?')
    ) {
      return
    }

    setBusy(order.id)

    try {
      remember(order.id)

      try {
        localStorage.setItem(`cartel-attempt-${order.id}`, '1')
      } catch {
        // ignore
      }

      const hash = await sendNear(order.escrowAccount, order.totalYocto)

      // A redirect wallet takes the browser away; we finish in the effect above on return.
      if (!hash) {
        setBusy('')
        setMessage('If your wallet shows the payment as sent, tap “I already paid” on the order and paste the transaction hash.')

        return
      }

      await verify(order.id, hash)
    } catch (e) {
      setBusy('')
      setError(e instanceof Error ? e.message : 'The payment was not completed.')
    }
  }

  async function placeOrder() {
    setError('')
    setMessage('')

    if (!accountId) return connect()

    if (delivery.name.trim().length < 2) return setError('Enter the name of the person receiving the order.')
    if (!/^\+?[0-9 ()-]{6,24}$/.test(delivery.phone.trim())) return setError('Enter a phone number the seller can reach.')
    if (delivery.address.trim().length < 5) return setError('Enter your delivery address.')
    if (delivery.city.trim().length < 2) return setError('Enter your city.')
    if (delivery.country.trim().length < 2) return setError('Enter your country.')

    try {
      localStorage.setItem(DELIVERY_KEY, JSON.stringify(delivery))
    } catch {
      // storage can be blocked
    }

    setBusy('checkout')

    try {
      const result = await post<{ orders: Order[] }>('/orders/checkout', {
        buyerAccount: accountId,
        items: lines.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
        delivery,
      })

      onItemsPaid(lines.map((line) => line.product.id))
      await refresh()
      setTab('orders')
      setMessage(
        result.orders.length > 1
          ? `${result.orders.length} orders created, one per seller. Pay each one below.`
          : 'Order created. Pay it below to put your funds in escrow.',
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create your order.')
    } finally {
      setBusy('')
    }
  }

  async function act(order: Order, action: 'confirm' | 'ship' | 'cancel' | 'dispute') {
    setError('')
    setMessage('')

    const body: Record<string, string> = action === 'ship' ? { sellerAccount: accountId } : { buyerAccount: accountId }

    if (action === 'dispute') {
      const reason = window.prompt('What went wrong? (at least 10 characters)')

      if (!reason) return
      body.reason = reason
    }

    if (action === 'confirm' && !window.confirm('Release the payment to the seller? Only do this if your order arrived.')) return

    setBusy(order.id)

    try {
      await post(`/orders/${order.id}/${action}`, body)
      setMessage(
        { confirm: 'Payment released to the seller.', ship: 'Marked as shipped.', cancel: 'Order cancelled.', dispute: 'Dispute opened. Cartel will review it.' }[action],
      )
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    } finally {
      setBusy('')
    }
  }

  const awaiting = orders.filter((order) => order.status === 'awaiting_payment').length

  return (
    <>
      <div className="c-tabs">
        <button className={'c-tab' + (tab === 'cart' ? ' on' : '')} onClick={() => setTab('cart')}>
          Cart
        </button>
        <button className={'c-tab' + (tab === 'orders' ? ' on' : '')} onClick={() => setTab('orders')}>
          My orders{awaiting > 0 ? ` (${awaiting})` : ''}
        </button>
        <button className={'c-tab' + (tab === 'sales' ? ' on' : '')} onClick={() => setTab('sales')}>
          My sales
        </button>
      </div>

      {message && <div className="c-info-msg">{message}</div>}
      {error && <div className="c-err">{error}</div>}

      {tab === 'cart' && (
        <>
          {lines.length === 0 ? (
            <div className="c-empty">
              <b>Your cart is empty</b>
              <span>Find something you like and add it here.</span>
              <button className="c-btn signal" onClick={onBrowse}>
                Browse the market
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 14, marginTop: 14 }}>
              <div className="c-box">
                {lines.map(({ product, quantity }) => (
                  <div className="c-line" key={product.id}>
                    <button style={{ all: 'unset', cursor: 'pointer' }} onClick={() => onOpenProduct(product.id)}>
                      {product.images[0] ? <img src={product.images[0]} alt="" /> : <div className="c-noimg"><Package size={20} /></div>}
                    </button>
                    <div className="c-linebody">
                      <b>{product.name}</b>
                      <span className="c-sub">
                        {near(product.priceNear)} · {shortAccount(product.sellerAccount)}
                      </span>
                      <div className="c-qty">
                        <button onClick={() => onChangeQuantity(product.id, -1)} aria-label="Less">
                          <Minus size={14} />
                        </button>
                        <b>{quantity}</b>
                        <button onClick={() => onChangeQuantity(product.id, 1)} disabled={quantity >= product.quantity} aria-label="More">
                          <Plus size={14} />
                        </button>
                      </div>
                    </div>
                    <button className="c-link" onClick={() => onRemove(product.id)} aria-label="Remove">
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="c-box">
                <div className="c-row">
                  <span>Subtotal</span>
                  <b>{near(String(subtotal))}</b>
                </div>
                <div className="c-row">
                  <span>Delivery</span>
                  <span className="c-sub">included in item prices</span>
                </div>
                <div className="c-row total">
                  <span>Total</span>
                  <span>{near(String(subtotal))}</span>
                </div>
                {sellers > 1 && <div className="c-sub">Your cart has {sellers} sellers, so you will get {sellers} separate orders.</div>}
              </div>

              <div className="c-box" style={{ margin: 0 }}>
                <b style={{ fontSize: 16 }}>Delivery address</b>
                <div className="c-sub" style={{ margin: '2px 0 10px' }}>Only the seller of your order sees this.</div>
                <div className="c-form" style={{ gap: 10 }}>
                  {([
                    ['name', 'Full name', 'Who will receive it', 'name'],
                    ['phone', 'Phone number', '+234 801 234 5678', 'tel'],
                    ['address', 'Address', 'House number, street, area', 'street-address'],
                    ['city', 'City', 'Lagos', 'address-level2'],
                    ['state', 'State or region', 'Lagos State', 'address-level1'],
                    ['country', 'Country', 'Nigeria', 'country-name'],
                    ['notes', 'Note for the seller (optional)', 'Landmark, call before arriving…', 'off'],
                  ] as const).map(([field, label, placeholder, autoComplete]) => (
                    <div className="c-field" key={field}>
                      <label htmlFor={`d-${field}`}>{label}</label>
                      <input
                        id={`d-${field}`}
                        value={delivery[field]}
                        autoComplete={autoComplete}
                        inputMode={field === 'phone' ? 'tel' : undefined}
                        maxLength={field === 'address' || field === 'notes' ? 200 : 80}
                        placeholder={placeholder}
                        onChange={(event) => setDelivery((previous) => ({ ...previous, [field]: event.target.value }))}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="c-box c-escrow">
                <ShieldCheck size={18} />
                <span>
                  Your NEAR goes into escrow, not to the seller. It is released when you confirm delivery or{' '}
                  {config?.escrowHours ?? 24} hours after shipping, unless you open a dispute.
                </span>
              </div>

              {ownItem && <div className="c-warnbox">Your cart contains your own listing. Remove it to continue.</div>}

              <button className="c-btn signal full" disabled={busy === 'checkout' || ownItem} onClick={() => void placeOrder()}>
                {!accountId ? 'Connect wallet to check out' : busy === 'checkout' ? 'Creating order…' : 'Place order'}
              </button>
            </div>
          )}
        </>
      )}

      {tab === 'orders' && (
        <OrderList
          orders={orders}
          loading={loading}
          empty="You have not ordered anything yet."
          signedIn={!!accountId}
          connect={connect}
          render={(order) => (
            <>
              {order.status === 'awaiting_payment' && (
                <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                  <button className="c-btn signal full" disabled={busy === order.id} onClick={() => void pay(order)}>
                    {busy === order.id ? 'Working…' : `Pay ${near(order.totalNear)} with wallet`}
                  </button>
                  <button className="c-link" disabled={busy === order.id} onClick={() => void act(order, 'cancel')}>
                    Cancel order
                  </button>
                </div>
              )}

              {order.status === 'awaiting_payment' && (
                <AlreadyPaid disabled={busy === order.id} onSubmit={(hash) => verify(order.id, hash)} />
              )}

              {order.status === 'in_escrow' && (
                <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                  <div className="c-sub">
                    {order.shippedAt
                      ? `Shipped. Auto-releases in ${countdown(order.releaseAfter)} unless you act.`
                      : 'Waiting for the seller to ship.'}
                  </div>
                  <button className="c-btn signal full" disabled={busy === order.id} onClick={() => void act(order, 'confirm')}>
                    I received it, release payment
                  </button>
                  <button className="c-link" disabled={busy === order.id} onClick={() => void act(order, 'dispute')}>
                    Something is wrong, open a dispute
                  </button>
                </div>
              )}

              {order.status === 'released' &&
                (reviewed[order.id] ? (
                  <div className="c-sub" style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
                    You rated this seller <Stars value={reviewed[order.id]} />
                  </div>
                ) : (
                  <ReviewBox
                    onSubmit={async (rating, comment) => {
                      await post('/reviews', { buyerAccount: accountId, orderId: order.id, rating, comment })
                      setMessage('Thanks! Your review is live on the seller page.')
                      await refresh()
                    }}
                  />
                ))}

              {order.status === 'disputed' && <div className="c-sub" style={{ marginTop: 10 }}>Reason: {order.disputeReason}</div>}
            </>
          )}
        />
      )}

      {tab === 'sales' && accountId && sales.length > 0 && <Dashboard sales={sales} />}

      {tab === 'sales' && (
        <OrderList
          orders={sales}
          loading={loading}
          empty="No sales yet. Once a buyer pays, the order appears here."
          signedIn={!!accountId}
          connect={connect}
          seller
          render={(order) => (
            <>
              {order.status === 'in_escrow' && !order.shippedAt && (
                <button className="c-btn signal full" style={{ marginTop: 10 }} disabled={busy === order.id} onClick={() => void act(order, 'ship')}>
                  Mark as shipped
                </button>
              )}
              {order.status === 'in_escrow' && order.shippedAt && (
                <div className="c-sub" style={{ marginTop: 10 }}>Funds release in {countdown(order.releaseAfter)} or when the buyer confirms.</div>
              )}
              {order.status === 'disputed' && <div className="c-sub" style={{ marginTop: 10 }}>Buyer says: {order.disputeReason}</div>}
            </>
          )}
        />
      )}
    </>
  )
}

function OrderList({
  orders,
  loading,
  empty,
  signedIn,
  connect,
  seller = false,
  render,
}: {
  orders: Order[]
  loading: boolean
  empty: string
  signedIn: boolean
  connect: () => void
  seller?: boolean
  render: (order: Order) => JSX.Element
}) {
  if (!signedIn) {
    return (
      <div className="c-empty">
        <b>Connect your wallet</b>
        <button className="c-btn signal" onClick={connect}>
          Connect wallet
        </button>
      </div>
    )
  }

  if (loading && orders.length === 0) return <div className="c-empty">Loading…</div>
  if (orders.length === 0) return <div className="c-empty">{empty}</div>

  return (
    <div style={{ display: 'grid', gap: 14, marginTop: 14 }}>
      {orders.map((order) => (
        <div className="c-box" key={order.id}>
          <div className="c-orderhead">
            <div>
              <b>Order #{order.id.slice(0, 8)}</b>
              <div className="c-sub">
                {seller ? `Buyer ${shortAccount(order.buyerAccount)}` : `Seller ${shortAccount(order.sellerAccount)}`} ·{' '}
                {new Date(order.createdAt).toLocaleDateString()}
              </div>
            </div>
            <span className={'c-status' + (order.status === 'released' ? ' good' : order.status === 'disputed' || order.status === 'refunded' ? ' bad' : '')}>
              {LABELS[order.status] ?? order.status}
            </span>
          </div>

          <Timeline order={order} />

          {order.items.map((item) => (
            <div className="c-line" key={item.productId}>
              {item.image ? <img src={item.image} alt="" /> : <div className="c-noimg" />}
              <div className="c-linebody">
                <b>{item.name}</b>
                <span className="c-sub">
                  {item.quantity} × {near(item.unitPriceNear)}
                </span>
              </div>
            </div>
          ))}

          <div className="c-row total">
            <span>{seller ? 'You receive' : 'Total'}</span>
            <span>{near(seller ? order.sellerReceivesNear : order.totalNear)}</span>
          </div>

          {order.delivery && (
            <div className="c-ship">
              <b>{seller ? 'Ship to' : 'Delivering to'}</b>
              <span>{order.delivery.name} · {order.delivery.phone}</span>
              <span>
                {order.delivery.address}, {order.delivery.city}
                {order.delivery.state ? `, ${order.delivery.state}` : ''}, {order.delivery.country}
              </span>
              {order.delivery.notes && <span className="c-sub">Note: {order.delivery.notes}</span>}
            </div>
          )}

          {order.txHash && (
            <a className="c-sub" href={explorerTx(order.txHash)} target="_blank" rel="noreferrer">
              View payment <ExternalLink size={11} style={{ verticalAlign: -1 }} />
            </a>
          )}

          {render(order)}
        </div>
      ))}
    </div>
  )
}

function ReviewBox({ onSubmit }: { onSubmit: (rating: number, comment: string) => Promise<void> }) {
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (!rating) return setError('Tap the stars to rate this seller.')

    setBusy(true)
    setError('')

    try {
      await onSubmit(rating, comment)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your review.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
      <b style={{ fontSize: 14 }}>How was this seller?</b>
      <StarPicker value={rating} onChange={setRating} />
      <textarea className="c-textarea" rows={2} maxLength={600} placeholder="Write a short review (optional)" value={comment} onChange={(event) => setComment(event.target.value)} />
      {error && <div className="c-err">{error}</div>}
      <button className="c-btn signal full" disabled={busy} onClick={() => void submit()}>
        {busy ? 'Posting…' : 'Post review'}
      </button>
    </div>
  )
}

// For a payment that was sent but not recognised: paste the transaction hash and check it again.
function AlreadyPaid({ onSubmit, disabled }: { onSubmit: (hash: string) => Promise<void>; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const [hash, setHash] = useState('')

  if (!open) {
    return (
      <button className="c-link" style={{ marginTop: 4 }} onClick={() => setOpen(true)}>
        I already paid
      </button>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
      <div className="c-sub">Open your wallet or nearblocks, copy the transaction hash of your payment, and paste it here.</div>
      <input
        id="paid-hash"
        className="c-textarea"
        style={{ marginTop: 0 }}
        value={hash}
        onChange={(event) => setHash(event.target.value.trim())}
        placeholder="Transaction hash"
        autoCapitalize="none"
      />
      <button className="c-btn signal full" disabled={disabled || hash.length < 40} onClick={() => void onSubmit(hash)}>
        Check my payment
      </button>
    </div>
  )
}
