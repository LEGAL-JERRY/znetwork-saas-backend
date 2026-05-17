-- ============================================================
-- Z-Network SaaS Database Schema
-- Run this on your PostgreSQL database (Supabase recommended)
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TABLE: isp_owners
-- The businesses/people who sign up to use Z-Network SaaS
-- ============================================================
CREATE TABLE IF NOT EXISTS isp_owners (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  is_verified BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE: tenants
-- Each ISP's portal configuration (one per isp_owner)
-- ============================================================
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES isp_owners(id) ON DELETE CASCADE,
  
  -- Portal identity
  slug VARCHAR(100) UNIQUE NOT NULL,          -- e.g. "z-network", "lafia-wifi"
  enterprise_name VARCHAR(255) NOT NULL,       -- displayed on login page
  logo_url TEXT,                               -- optional logo
  support_whatsapp VARCHAR(20),                -- WhatsApp number for support
  
  -- Payment config
  paystack_public_key VARCHAR(255),            -- their own Paystack key
  paystack_secret_key VARCHAR(255),            -- stored encrypted
  bank_account_number VARCHAR(20),
  bank_name VARCHAR(100),
  bank_account_name VARCHAR(255),
  
  -- Portal status
  is_active BOOLEAN DEFAULT TRUE,
  portal_url TEXT,                             -- computed: platform.com/portal/:slug
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE: tenant_plans
-- Each tenant has up to 6 internet plans
-- ============================================================
CREATE TABLE IF NOT EXISTS tenant_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  
  plan_name VARCHAR(100) NOT NULL,            -- e.g. "Daily Plan", "Weekly Plan"
  price INTEGER NOT NULL,                      -- in Naira (₦)
  duration_hours INTEGER NOT NULL,             -- e.g. 24, 48, 168 (7 days)
  speed_limit VARCHAR(50),                     -- e.g. "Unlimited", "5 Mbps"
  devices_allowed INTEGER DEFAULT 1,
  is_popular BOOLEAN DEFAULT FALSE,            -- shows "★ POPULAR" badge
  display_order INTEGER DEFAULT 0,             -- controls sort order on page
  is_active BOOLEAN DEFAULT TRUE,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE: vouchers
-- Generated after successful payment per tenant
-- ============================================================
CREATE TABLE IF NOT EXISTS vouchers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES tenant_plans(id),
  
  code VARCHAR(20) UNIQUE NOT NULL,            -- the PIN shown to customer
  customer_phone VARCHAR(20),
  paystack_reference VARCHAR(255),
  amount_paid INTEGER NOT NULL,
  
  is_used BOOLEAN DEFAULT FALSE,
  used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE: saas_subscriptions (optional - for billing ISP owners)
-- ============================================================
CREATE TABLE IF NOT EXISTS saas_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES isp_owners(id),
  plan VARCHAR(50) DEFAULT 'free',            -- 'free', 'basic', 'pro'
  status VARCHAR(50) DEFAULT 'active',
  billing_cycle VARCHAR(20) DEFAULT 'monthly',
  next_billing_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES for performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
CREATE INDEX IF NOT EXISTS idx_tenant_plans_tenant ON tenant_plans(tenant_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_code ON vouchers(code);
CREATE INDEX IF NOT EXISTS idx_vouchers_tenant ON vouchers(tenant_id);

-- ============================================================
-- SAMPLE DATA — Z-Network as the first tenant (your own ISP)
-- ============================================================
INSERT INTO isp_owners (id, email, password_hash, full_name, phone, is_verified)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'jay@z-network.ng',
  '$2a$10$placeholder_replace_with_real_hash',
  'Jay (Z-Network Owner)',
  '08000000000',
  TRUE
) ON CONFLICT DO NOTHING;

INSERT INTO tenants (
  id, owner_id, slug, enterprise_name, support_whatsapp,
  bank_account_number, bank_name, bank_account_name, is_active
) VALUES (
  'b0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'z-network',
  'Z-Network',
  '2348000000000',
  '0000000000',
  'GTBank',
  'Z-Network Nigeria',
  TRUE
) ON CONFLICT DO NOTHING;

INSERT INTO tenant_plans (tenant_id, plan_name, price, duration_hours, speed_limit, devices_allowed, is_popular, display_order)
VALUES
  ('b0000000-0000-0000-0000-000000000001', 'Daily Plan',    350,  24,   'Unlimited', 1, TRUE,  1),
  ('b0000000-0000-0000-0000-000000000001', '2-Day Plan',    500,  48,   'Unlimited', 1, FALSE, 2),
  ('b0000000-0000-0000-0000-000000000001', '3½-Day Plan',   1000, 84,   'Unlimited', 1, FALSE, 3),
  ('b0000000-0000-0000-0000-000000000001', 'Weekly Plan',   2000, 168,  'Unlimited', 1, FALSE, 4),
  ('b0000000-0000-0000-0000-000000000001', 'Monthly Plan',  6000, 720,  'Unlimited', 1, FALSE, 5)
ON CONFLICT DO NOTHING;
