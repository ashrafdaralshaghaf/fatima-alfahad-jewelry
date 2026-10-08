-- Fatima Alfahad Jewelry - initial schema
-- Money is stored in KWD (3 decimals, the native precision of the Kuwaiti dinar).

CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            text NOT NULL,
  password_hash    text NOT NULL,
  full_name        text NOT NULL,
  phone            text,
  role             text NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','admin')),
  is_active        boolean NOT NULL DEFAULT true,
  marketing_opt_in boolean NOT NULL DEFAULT false,
  failed_attempts  integer NOT NULL DEFAULT 0,
  locked_until     timestamptz,
  last_login_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,          -- sha256 of the cookie value; the raw token is never stored
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ip           text,
  user_agent   text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_exp_idx ON sessions (expires_at);

CREATE TABLE password_resets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE categories (
  slug         text PRIMARY KEY CHECK (slug ~ '^[a-z0-9-]+$'),
  name_en      text NOT NULL,
  name_ar      text NOT NULL,
  image        text,
  sort_order   integer NOT NULL DEFAULT 0,
  size_kind    text CHECK (size_kind IN ('ring','length')),   -- ring = ring sizer, length = chain length (cm)
  sizes        integer[] NOT NULL DEFAULT '{}',
  default_size integer,
  engravable   boolean NOT NULL DEFAULT true,
  is_active    boolean NOT NULL DEFAULT true
);

CREATE TABLE collections (
  slug        text PRIMARY KEY CHECK (slug ~ '^[a-z0-9-]+$'),
  name_en     text NOT NULL,
  name_ar     text NOT NULL,
  tag_en      text NOT NULL DEFAULT '',
  tag_ar      text NOT NULL DEFAULT '',
  desc_en     text NOT NULL DEFAULT '',
  desc_ar     text NOT NULL DEFAULT '',
  image       text,
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true
);

CREATE TABLE products (
  id                 text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]+$'),
  category           text NOT NULL REFERENCES categories(slug) ON UPDATE CASCADE,
  collection         text REFERENCES collections(slug) ON UPDATE CASCADE ON DELETE SET NULL,
  price_kwd          numeric(10,3) NOT NULL CHECK (price_kwd >= 0),
  natural_price_kwd  numeric(10,3) CHECK (natural_price_kwd >= 0),
  name_en            text NOT NULL,
  name_ar            text NOT NULL,
  story_en           text NOT NULL DEFAULT '',
  story_ar           text NOT NULL DEFAULT '',
  metal_en           text NOT NULL DEFAULT '',
  metal_ar           text NOT NULL DEFAULT '',
  stone_en           text NOT NULL DEFAULT '',
  stone_ar           text NOT NULL DEFAULT '',
  is_active          boolean NOT NULL DEFAULT true,
  is_new             boolean NOT NULL DEFAULT false,
  sort_order         integer NOT NULL DEFAULT 0,
  stock              integer CHECK (stock >= 0),              -- NULL = made to order (unlimited)
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_cat_idx ON products (category);
CREATE INDEX products_col_idx ON products (collection);

CREATE TABLE product_images (
  id          serial PRIMARY KEY,
  product_id  text NOT NULL REFERENCES products(id) ON DELETE CASCADE ON UPDATE CASCADE,
  url         text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0
);
CREATE INDEX product_images_idx ON product_images (product_id, sort_order);

CREATE TABLE orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no         text NOT NULL UNIQUE,
  user_id          uuid REFERENCES users(id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','confirmed','in_production','shipped','delivered','cancelled','refunded')),
  payment_status   text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','paid','failed','refunded')),
  payment_method   text NOT NULL CHECK (payment_method IN ('knet','card')),
  payment_ref      text,
  customer_name    text NOT NULL,
  customer_phone   text NOT NULL,
  customer_email   text NOT NULL,
  country          text NOT NULL,
  area             text NOT NULL,
  block            text NOT NULL,
  street           text NOT NULL,
  house            text NOT NULL,
  avenue           text,
  delivery_date    date,
  gift_message     text,
  currency         text NOT NULL DEFAULT 'KWD',
  fx_rate          numeric(12,6) NOT NULL DEFAULT 1,
  subtotal_kwd     numeric(10,3) NOT NULL,
  shipping_kwd     numeric(10,3) NOT NULL DEFAULT 0,
  total_kwd        numeric(10,3) NOT NULL,
  total_display    numeric(12,2) NOT NULL,
  lang             text NOT NULL DEFAULT 'en',
  admin_notes      text,
  ip               text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  paid_at          timestamptz
);
CREATE INDEX orders_user_idx ON orders (user_id);
CREATE INDEX orders_status_idx ON orders (status);
CREATE INDEX orders_created_idx ON orders (created_at DESC);

CREATE TABLE order_items (
  id              serial PRIMARY KEY,
  order_id        uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id      text REFERENCES products(id) ON UPDATE CASCADE ON DELETE SET NULL,
  name_en         text NOT NULL,              -- snapshots: an order must stay readable if the product changes later
  name_ar         text NOT NULL,
  image           text,
  unit_price_kwd  numeric(10,3) NOT NULL,
  qty             integer NOT NULL CHECK (qty > 0),
  size            integer,
  diamond         text CHECK (diamond IN ('lab','natural')),
  engraving       text,
  gift_wrap       boolean NOT NULL DEFAULT true
);
CREATE INDEX order_items_order_idx ON order_items (order_id);

CREATE TABLE order_events (
  id         serial PRIMARY KEY,
  order_id   uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind       text NOT NULL,                   -- created | status | payment | note
  value      text,
  note       text,
  actor_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_events_idx ON order_events (order_id, created_at);

CREATE TABLE wishlists (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);

CREATE TABLE appointments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  kind        text NOT NULL CHECK (kind IN ('video','home')),
  on_date     date NOT NULL,
  at_time     text NOT NULL,
  name        text NOT NULL,
  mobile      text NOT NULL,
  piece       text,
  status      text NOT NULL DEFAULT 'new' CHECK (status IN ('new','confirmed','completed','cancelled')),
  admin_notes text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bespoke_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  piece_type  text NOT NULL,
  diamond     text NOT NULL CHECK (diamond IN ('lab','natural','unsure')),
  budget      text,
  idea        text NOT NULL,
  name        text NOT NULL,
  mobile      text NOT NULL,
  photos      text[] NOT NULL DEFAULT '{}',   -- private file names (never served publicly)
  status      text NOT NULL DEFAULT 'new'
              CHECK (status IN ('new','in_review','proposal_sent','in_production','completed','cancelled')),
  admin_notes text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscribers (
  id              serial PRIMARY KEY,
  email           text NOT NULL,
  source          text NOT NULL DEFAULT 'footer',
  created_at      timestamptz NOT NULL DEFAULT now(),
  unsubscribed_at timestamptz
);
CREATE UNIQUE INDEX subscribers_email_uq ON subscribers (lower(email));

CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_email text,
  action      text NOT NULL,
  entity      text,
  entity_id   text,
  details     jsonb,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_created_idx ON audit_log (created_at DESC);
