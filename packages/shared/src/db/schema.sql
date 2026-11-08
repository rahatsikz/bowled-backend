-- Schema shared by api and worker (CREATE IF NOT EXISTS, idempotent on boot).

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  push_token TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, push_token)
);

CREATE TABLE IF NOT EXISTS deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  video_path TEXT NOT NULL,
  delivery_angle TEXT NOT NULL CHECK (delivery_angle = 'side-on'),
  capture_fps INTEGER NOT NULL CHECK (capture_fps > 0),
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'complete', 'failed')),
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL UNIQUE REFERENCES deliveries(id),
  status TEXT NOT NULL CHECK (status IN ('complete', 'failed')),
  report JSONB,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
