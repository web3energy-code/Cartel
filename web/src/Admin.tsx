import { useState } from 'react'
import { API_URL, near, shortAccount } from './api'
import type { Order } from './api'

// Hidden owner tools. Open the site with #admin-tools on the end of the address.
export default function Admin() {
  const [token, setToken] = useState('')
  const [payer, setPayer] = useState('')
  const [txHash, setTxHash] = useState('')
  const [disputes, setDisputes] = useState<Order[] | null>(null)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function run() {
    setError('')
    setMessage('')
    setBusy('refund')

    try {
      const headers = { 'x-admin-token': token.trim() }
      const call = async (path: string, body: unknown) => {
        const response = await fetch(API_URL + path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify(body),
        })
        const data = await response.json().catch(() => ({}))

        if (!response.ok || data.success === false) throw new Error(data.error || 'That did not work.')

        return data
      }

      const data = await call('/admin/refund-payment', { txHash: txHash.trim(), payer: payer.trim() })

      setMessage(`Refunded ${data.amountNear} NEAR to ${payer.trim()}. Refund transaction: ${data.refundTx}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    } finally {
      setBusy('')
    }
  }

  async function loadDisputes() {
    setError('')
    setBusy('load')

    try {
      const response = await fetch(`${API_URL}/admin/disputes`, { headers: { 'x-admin-token': token.trim() } })
      const data = await response.json().catch(() => ({}))

      if (!response.ok || data.success === false) throw new Error(data.error || 'Could not load disputes.')

      setDisputes(data.disputes)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load disputes.')
    } finally {
      setBusy('')
    }
  }

  async function settle(id: string, action: 'release' | 'refund') {
    setError('')
    setMessage('')
    setBusy(id)

    try {
      const response = await fetch(`${API_URL}/orders/${id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': token.trim() },
        body: JSON.stringify({ action }),
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok || data.success === false) throw new Error(data.error || 'That did not work.')

      setMessage(action === 'release' ? 'Paid the seller.' : 'Refunded the buyer.')
      await loadDisputes()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    } finally {
      setBusy('')
    }
  }

  return (
    <>
      <section className="c-hero">
        <h1>Owner tools.</h1>
        <p>Only you should use this page. It needs your admin token.</p>
      </section>

      <div className="c-form">
        <div className="c-field">
          <label htmlFor="a-token">Admin token</label>
          <input id="a-token" type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" />
        </div>

        <h2 style={{ fontSize: 20 }}>Refund an extra payment</h2>
        <div className="c-sub">Use this when someone paid twice. Only payments that are not attached to an order can be refunded, and each one only once.</div>

        <div className="c-field">
          <label htmlFor="a-payer">Account that paid</label>
          <input id="a-payer" value={payer} onChange={(event) => setPayer(event.target.value.trim())} placeholder="buyer.testnet" autoCapitalize="none" />
        </div>
        <div className="c-field">
          <label htmlFor="a-hash">Transaction hash of the extra payment</label>
          <input id="a-hash" value={txHash} onChange={(event) => setTxHash(event.target.value.trim())} autoCapitalize="none" />
        </div>
        <button className="c-btn signal full" disabled={!token || !payer || !txHash || !!busy} onClick={() => void run()}>
          {busy === 'refund' ? 'Refunding…' : 'Refund this payment'}
        </button>

        <h2 style={{ fontSize: 20, marginTop: 10 }}>Open disputes</h2>
        <button className="c-btn ghost full" disabled={!token || !!busy} onClick={() => void loadDisputes()}>
          {busy === 'load' ? 'Loading…' : disputes ? 'Reload disputes' : 'Show open disputes'}
        </button>

        {disputes && disputes.length === 0 && <div className="c-sub">No open disputes.</div>}

        {disputes?.map((order) => (
          <div className="c-box" key={order.id} style={{ margin: 0 }}>
            <b>Order #{order.id.slice(0, 8)}</b>
            <div className="c-sub">{order.items.map((item) => `${item.quantity} × ${item.name}`).join(', ')}</div>
            <div className="c-row"><span>Amount</span><b>{near(order.totalNear)}</b></div>
            <div className="c-row"><span>Buyer</span><span>{shortAccount(order.buyerAccount)}</span></div>
            <div className="c-row"><span>Seller</span><span>{shortAccount(order.sellerAccount)}</span></div>
            <div className="c-sub" style={{ marginBottom: 10 }}>Reason: {order.disputeReason}</div>
            <div className="c-two">
              <button className="c-btn ghost" disabled={!!busy} onClick={() => void settle(order.id, 'release')}>Pay the seller</button>
              <button className="c-btn signal" disabled={!!busy} onClick={() => void settle(order.id, 'refund')}>Refund the buyer</button>
            </div>
          </div>
        ))}

        {message && <div className="c-info-msg" style={{ overflowWrap: 'anywhere' }}>{message}</div>}
        {error && <div className="c-err">{error}</div>}
      </div>
    </>
  )
}
