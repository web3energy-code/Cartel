import { useState } from 'react'
import { API_URL } from './api'

// Hidden owner tools. Open the site with #admin-tools on the end of the address.
export default function Admin() {
  const [token, setToken] = useState('')
  const [payer, setPayer] = useState('')
  const [txHash, setTxHash] = useState('')
  const [orderId, setOrderId] = useState('')
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function run(kind: 'refund' | 'release' | 'refundOrder') {
    setError('')
    setMessage('')
    setBusy(kind)

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

      if (kind === 'refund') {
        const data = await call('/admin/refund-payment', { txHash: txHash.trim(), payer: payer.trim() })

        setMessage(`Refunded ${data.amountNear} NEAR to ${payer.trim()}. Refund transaction: ${data.refundTx}`)
      } else {
        await call(`/orders/${orderId.trim()}/resolve`, { action: kind === 'release' ? 'release' : 'refund' })
        setMessage(kind === 'release' ? 'Order released to the seller.' : 'Order refunded to the buyer.')
      }
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
        <button className="c-btn signal full" disabled={!token || !payer || !txHash || !!busy} onClick={() => void run('refund')}>
          {busy === 'refund' ? 'Refunding…' : 'Refund this payment'}
        </button>

        <h2 style={{ fontSize: 20, marginTop: 10 }}>Settle a dispute</h2>
        <div className="c-field">
          <label htmlFor="a-order">Order id</label>
          <input id="a-order" value={orderId} onChange={(event) => setOrderId(event.target.value.trim())} autoCapitalize="none" />
        </div>
        <div className="c-two">
          <button className="c-btn ghost" disabled={!token || !orderId || !!busy} onClick={() => void run('release')}>
            Pay the seller
          </button>
          <button className="c-btn ghost" disabled={!token || !orderId || !!busy} onClick={() => void run('refundOrder')}>
            Refund the buyer
          </button>
        </div>

        {message && <div className="c-info-msg" style={{ overflowWrap: 'anywhere' }}>{message}</div>}
        {error && <div className="c-err">{error}</div>}
      </div>
    </>
  )
}
