-- ====================================================================
-- CHCKPOINT / PERIMETRR STAFF ATTENDANCE PLATFORM (v3.0.0)
-- Production Supabase Database Schema & Multi-Tenant Tables
-- ====================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- --------------------------------------------------------------------
-- 1. Tenants & Workspace Organizations
-- Stores registered companies, branding, office coordinates & perimeters
-- Standardized Workspace Code Format: ABCD-1234 (e.g. LIFE-2026)
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(128) NOT NULL,
    workspace_code VARCHAR(16) UNIQUE NOT NULL, -- Format: ABCD-1234 (e.g. LIFE-2026)
    tagline VARCHAR(255) DEFAULT 'Staff Attendance & Workplace Portal',
    logo_url TEXT,
    brand_color VARCHAR(16) DEFAULT '#1a56db',
    office_name VARCHAR(128) DEFAULT 'Main HQ Office',
    latitude NUMERIC(10, 7) NOT NULL DEFAULT 6.4357,
    longitude NUMERIC(10, 7) NOT NULL DEFAULT 3.4738,
    radius_meters INTEGER NOT NULL DEFAULT 100,
    admin_email VARCHAR(128),
    plan_tier VARCHAR(32) DEFAULT 'Pro',
    subscription_status VARCHAR(32) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for instant workspace code matching during 1-tap pairing
CREATE INDEX IF NOT EXISTS idx_tenants_workspace_code ON public.tenants (UPPER(workspace_code));
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON public.tenants (LOWER(slug));

-- --------------------------------------------------------------------
-- 2. Staff Directory & Employee Roster
-- Employee directory scoped by tenant workspace
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_slug VARCHAR(64) NOT NULL REFERENCES public.tenants(slug) ON DELETE CASCADE,
    name VARCHAR(128) NOT NULL,
    dept VARCHAR(64) DEFAULT 'General Staff',
    pin_hash VARCHAR(255),
    biometric_cred_id TEXT,
    device_id VARCHAR(128),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_slug, name)
);

CREATE INDEX IF NOT EXISTS idx_staff_tenant_name ON public.staff (tenant_slug, LOWER(name));
CREATE INDEX IF NOT EXISTS idx_staff_device_id ON public.staff (device_id);

-- --------------------------------------------------------------------
-- 3. Attendance Logs & Check-In History
-- Immutable audit record of daily attendance submissions
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_slug VARCHAR(64) NOT NULL REFERENCES public.tenants(slug) ON DELETE CASCADE,
    staff_name VARCHAR(128) NOT NULL,
    dept VARCHAR(64) DEFAULT 'General Staff',
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    type VARCHAR(16) NOT NULL CHECK (type IN ('IN', 'OUT')),
    status VARCHAR(32) DEFAULT 'ON_SITE', -- ON_SITE, LATE, WFH, OUTSIDE_PERIMETER
    distance_meters NUMERIC(8, 2),
    verification_method VARCHAR(64) DEFAULT 'GPS_PERIMETER', -- GPS_PERIMETER, WEBAUTHN_BIOMETRIC, PIN
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attendance_tenant_time ON public.attendance_logs (tenant_slug, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_staff ON public.attendance_logs (tenant_slug, staff_name, timestamp DESC);

-- --------------------------------------------------------------------
-- 4. Device Transfer & Reset Requests
-- Stores employee device unbind & transfer notifications for admins
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.device_transfers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_slug VARCHAR(64) NOT NULL REFERENCES public.tenants(slug) ON DELETE CASCADE,
    staff_name VARCHAR(128) NOT NULL,
    device_id VARCHAR(128) NOT NULL,
    status VARCHAR(32) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    requested_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_device_transfers_tenant ON public.device_transfers (tenant_slug, status, requested_at DESC);

-- --------------------------------------------------------------------
-- 5. Tenant Admin Users & Credentials
-- Administrative login access for tenant dashboard
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_slug VARCHAR(64) NOT NULL REFERENCES public.tenants(slug) ON DELETE CASCADE,
    email VARCHAR(128) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(32) DEFAULT 'admin', -- admin, manager, superadmin
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_slug, email)
);

CREATE INDEX IF NOT EXISTS idx_admin_users_email ON public.admin_users (LOWER(email));

-- --------------------------------------------------------------------
-- 6. System & App Config KV Store
-- Stores global platform settings & client caches
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_config (
    key VARCHAR(128) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- --------------------------------------------------------------------
-- SAMPLE SEED DATA (Default Workspaces with ABCD-1234 Code Format)
-- --------------------------------------------------------------------
INSERT INTO public.tenants (slug, name, workspace_code, latitude, longitude, radius_meters)
VALUES 
    ('lifecard', 'Lifecard International', 'LIFE-2026', 6.4357, 3.4738, 100),
    ('acme', 'Acme Corporation', 'ACME-4829', 6.4380, 3.4750, 150),
    ('globex', 'Globex Corporation', 'GLOB-1024', 6.4300, 3.4700, 120),
    ('techcorp', 'TechCorp Solutions', 'TECH-9901', 6.4400, 3.4800, 100)
ON CONFLICT (slug) DO UPDATE 
SET workspace_code = EXCLUDED.workspace_code;

-- Seed Sample Staff Roster
INSERT INTO public.staff (tenant_slug, name, dept)
VALUES 
    ('lifecard', 'Kenneth Valentine', 'Engineering'),
    ('lifecard', 'Blessing Joy', 'Human Resources'),
    ('lifecard', 'Uche Nnamdi', 'Operations')
ON CONFLICT (tenant_slug, name) DO NOTHING;

-- Grant permissions for Supabase anon & authenticated roles
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
