CREATE TABLE IF NOT EXISTS ig_orders (
  id SERIAL PRIMARY KEY,
  idem_key TEXT UNIQUE NOT NULL,
  deal_reference TEXT UNIQUE NOT NULL,
  epic TEXT NOT NULL, pair TEXT, direction TEXT NOT NULL,
  size NUMERIC NOT NULL, stop_distance NUMERIC, limit_distance NUMERIC,
  status TEXT NOT NULL, deal_id TEXT, reason TEXT, level NUMERIC,
  signal JSONB, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ig_positions (
  deal_id TEXT PRIMARY KEY, deal_reference TEXT, epic TEXT NOT NULL, pair TEXT,
  direction TEXT NOT NULL, size NUMERIC NOT NULL, open_level NUMERIC,
  stop_level NUMERIC, limit_level NUMERIC, status TEXT NOT NULL, source TEXT,
  opened_at TIMESTAMPTZ, closed_at TIMESTAMPTZ, close_level NUMERIC,
  close_reason TEXT, pnl_gbp NUMERIC, pnl_estimated BOOLEAN DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS ig_positions_status ON ig_positions(status);
CREATE TABLE IF NOT EXISTS bot_state (key TEXT PRIMARY KEY, value JSONB);
CREATE TABLE IF NOT EXISTS audit_log (id SERIAL PRIMARY KEY, ts TIMESTAMPTZ DEFAULT now(), event TEXT, data JSONB);
