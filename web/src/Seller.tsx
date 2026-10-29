import { useEffect, useState } from 'react'
import { ArrowLeft, MessageCircle, Package } from 'lucide-react'
import { api, near, nameOf, shortAccount } from './api'
import type { Product, Profile, Review } from './api'
import { Avatar, Stars } from './ui'
import { useWallet } from './wallet'

interface SellerData {
  profile: Profile
  stats: { rating: number; reviewCount: number; completedSales: number }
  products: Product[]
  reviews: Review[]
}

export default function Seller({
  account,
  onBack,
  onMessage,
  onOpenProduct,
}: {
  account: string
  onBack: () => void
  onMessage: (account: string) => void
  onOpenProduct: (id: string) => void
}) {
  const { accountId, connect } = useWallet()
  const [data, setData] = useState<SellerData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setData(null)
    setError('')

    api<SellerData>(`/sellers/${encodeURIComponent(account)}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load this seller.'))
  }, [account])

  const mine = accountId === account

  return (
    <>
      <button className="c-back" onClick={onBack}>
        <ArrowLeft size={18} /> Back
      </button>

      {error && <div className="c-empty">{error}</div>}
      {!data && !error && <div className="c-empty">Loading…</div>}

      {data && (
        <>
          <div className="c-seller-head">
            <Avatar profile={data.profile} account={account} size={72} />

            <div>
              <h1>{nameOf(data.profile, account)}</h1>
              {data.profile.username && data.profile.displayName && <div className="c-sub">@{data.profile.username}</div>}
              <div className="c-sub" style={{ overflowWrap: 'anywhere' }}>
                {shortAccount(account)}
                {data.profile.location ? ` · ${data.profile.location}` : ''}
              </div>
            </div>

            {data.profile.bio && <p className="c-desc" style={{ margin: 0 }}>{data.profile.bio}</p>}

            <div className="c-stats">
              <div>
                <b>{data.stats.reviewCount ? data.stats.rating.toFixed(1) : '—'}</b>
                <span className="c-sub">{data.stats.reviewCount} {data.stats.reviewCount === 1 ? 'review' : 'reviews'}</span>
              </div>
              <div>
                <b>{data.stats.completedSales}</b>
                <span className="c-sub">completed sales</span>
              </div>
              <div>
                <b>{data.products.length}</b>
                <span className="c-sub">listings</span>
              </div>
            </div>

            {data.stats.reviewCount > 0 && <Stars value={data.stats.rating} size={20} />}

            {!mine && (
              <button className="c-btn signal" onClick={() => (accountId ? onMessage(account) : connect())}>
                <MessageCircle size={18} /> {accountId ? 'Message seller' : 'Connect wallet to message'}
              </button>
            )}
          </div>

          <h2 style={{ fontSize: 22, marginBottom: 12 }}>Listings</h2>

          {data.products.length === 0 ? (
            <div className="c-empty">No listings right now.</div>
          ) : (
            <div className="c-grid">
              {data.products.map((product) => (
                <button key={product.id} className="c-card" onClick={() => onOpenProduct(product.id)}>
                  {product.images[0] ? <img src={product.images[0]} alt={product.name} loading="lazy" /> : <div className="c-noimg"><Package size={28} /></div>}
                  <div className="c-card-body">
                    <span className="c-card-name">{product.name}</span>
                    <span className="c-price">
                      {near(product.priceNear).replace(' NEAR', '')}
                      <small>NEAR</small>
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}

          <h2 style={{ fontSize: 22, margin: '26px 0 6px' }}>Reviews</h2>

          {data.reviews.length === 0 ? (
            <div className="c-empty">No reviews yet. Reviews appear after a buyer completes an order.</div>
          ) : (
            <div className="c-box">
              {data.reviews.map((review) => (
                <div className="c-review" key={review.id}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Avatar profile={review.reviewer} account={review.buyerAccount} size={32} />
                    <div style={{ display: 'grid' }}>
                      <b style={{ fontSize: 14 }}>{nameOf(review.reviewer, review.buyerAccount)}</b>
                      <span className="c-sub">{new Date(review.createdAt).toLocaleDateString()}</span>
                    </div>
                    <span style={{ marginLeft: 'auto' }}>
                      <Stars value={review.rating} />
                    </span>
                  </div>
                  {review.comment && <div>{review.comment}</div>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  )
}
