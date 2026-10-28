-- Cartel: run this once in Supabase → SQL Editor → Run.
-- All NEAR amounts are stored as TEXT holding whole yoctoNEAR (1 NEAR = 10^24), never floats.

create extension if not exists pgcrypto;

create table if not exists cartel_products (
  id uuid primary key default gen_random_uuid(),
  seller_account text not null,
  name text not null,
  description text not null,
  category text not null,
  condition text not null default 'New',
  price_yocto text not null,
  quantity integer not null check (quantity >= 0),
  location text not null default '',
  image_urls text[] not null default '{}',
  status text not null default 'published',
  created_at timestamptz not null default now()
);

create index if not exists cartel_products_status_idx on cartel_products (status, created_at desc);
create index if not exists cartel_products_seller_idx on cartel_products (seller_account);

create table if not exists cartel_orders (
  id uuid primary key default gen_random_uuid(),
  buyer_account text not null,
  seller_account text not null,
  escrow_account text not null,
  network text not null,
  status text not null default 'awaiting_payment',
  total_yocto text not null,
  fee_bps integer not null default 1000,
  tx_hash text unique,
  paid_at timestamptz,
  shipped_at timestamptz,
  release_after timestamptz,
  released_at timestamptz,
  seller_payout_tx text,
  fee_payout_tx text,
  refund_tx text,
  dispute_reason text,
  disputed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists cartel_orders_buyer_idx on cartel_orders (buyer_account, created_at desc);
create index if not exists cartel_orders_seller_idx on cartel_orders (seller_account, created_at desc);
create index if not exists cartel_orders_status_idx on cartel_orders (status, release_after);

create table if not exists cartel_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references cartel_orders(id) on delete cascade,
  product_id uuid references cartel_products(id) on delete set null,
  product_name text not null,
  image_url text,
  unit_price_yocto text not null,
  quantity integer not null check (quantity > 0)
);

create index if not exists cartel_order_items_order_idx on cartel_order_items (order_id);

-- Only the API (service role key) touches these tables.
alter table cartel_products enable row level security;
alter table cartel_orders enable row level security;
alter table cartel_order_items enable row level security;

-- Public bucket for listing photos.
insert into storage.buckets (id, name, public)
values ('cartel-products', 'cartel-products', true)
on conflict (id) do update set public = true;
