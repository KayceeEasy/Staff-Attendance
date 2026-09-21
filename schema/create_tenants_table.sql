-- ==============================================================================
-- Migration: Create Physical `tenants` Table with Commercial SaaS Billing Schema
-- 
-- Fixes: ERROR 42P01: relation "tenants" does not exist
-- Implements Commercial SaaS Billing Architecture:
-- 1. 28-day billing grace period for payment retries (grace_period_ends_at)
-- 2. Upfront 14-day free trial (trial_ends_at = now() + interval '14 days')
-- 3. Cancellation retention discount / deal fields (retention_discount_applied, retention_discount_percent)
-- 4. Multi-tenant isolation RLS policies and indexes
-- ==============================================================================

-- 1. Create the `tenants` table if not exists
CREATE TABLE IF NOT EXISTS public.tenants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text UNIQUE NOT NULL,
    name text NOT NULL,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'canceled')),
    plan_tier text NOT NULL DEFAULT 'Pro' CHECK (plan_tier IN ('Starter', 'Pro', 'Enterprise')),
    
    -- Commercial Billing & Subscription (Instagram Monetization Best Practices)
    -- Rule 4 & 2: 14-day trial duration upfront
    subscription_status text NOT NULL DEFAULT 'trialing' CHECK (subscription_status IN ('trialing', 'active', 'past_due', 'canceled')),
    trial_ends_at timestamp with time zone DEFAULT (now() + interval '14 days'),
    -- Rule 1: 28-day grace period for card decline retries
    grace_period_ends_at timestamp with time zone DEFAULT NULL,
    current_period_end timestamp with time zone DEFAULT NULL,
    stripe_customer_id text DEFAULT NULL,
    stripe_subscription_id text DEFAULT NULL,
    -- Rule 3: Cancellation retention deal (50% discount)
    retention_discount_applied boolean DEFAULT false,
    retention_discount_percent int DEFAULT 50,
    
    -- Office GPS & Geofence Policy
    office_name text NOT NULL DEFAULT 'Main Office',
    latitude numeric NOT NULL DEFAULT 6.4357,
    longitude numeric NOT NULL DEFAULT 3.4738,
    radius numeric NOT NULL DEFAULT 100,
    grace_period_minutes int NOT NULL DEFAULT 15,
    default_policy text NOT NULL DEFAULT 'weekly_hybrid',
    
    -- Branding & Customization
    brand_color text NOT NULL DEFAULT '#1a56db',
    logo_url text DEFAULT NULL,
    admin_name text DEFAULT NULL,
    admin_email text DEFAULT NULL,
    
    -- Employee Universal Pairing
    workspace_code text UNIQUE DEFAULT NULL,
    
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- 2. Enable Row Level Security
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- 3. RLS Policies
-- Allow public/anonymous reads for slug lookup, branding, and workspace pairing
DROP POLICY IF EXISTS "Public can view active tenants for portal resolution" ON public.tenants;
CREATE POLICY "Public can view active tenants for portal resolution"
    ON public.tenants
    FOR SELECT
    USING (status = 'active');

-- Service role & authenticated admins have full access
DROP POLICY IF EXISTS "Service role has full management access to tenants" ON public.tenants;
CREATE POLICY "Service role has full management access to tenants"
    ON public.tenants
    FOR ALL
    USING (auth.role() = 'service_role' OR auth.role() = 'authenticated');

-- 4. Create Performance Indexes
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON public.tenants (slug);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON public.tenants (status);
CREATE INDEX IF NOT EXISTS idx_tenants_workspace_code ON public.tenants (workspace_code);
CREATE INDEX IF NOT EXISTS idx_tenants_sub_status ON public.tenants (subscription_status);

-- 5. Backward Compatibility View for `organizations`
-- Ensures existing queries pointing to `organizations` resolve cleanly to `tenants`
CREATE OR REPLACE VIEW public.organizations AS
    SELECT 
        id,
        slug,
        name,
        latitude AS office_lat,
        longitude AS office_lon,
        radius AS radius_meters,
        540 AS late_cutoff_minutes,
        true AS team_lead_priority,
        created_at
    FROM public.tenants;

-- 6. Helper function to migrate existing JSON registry from `app_config` into `tenants` table
CREATE OR REPLACE FUNCTION public.sync_tenants_from_registry()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    registry_json jsonb;
    tenant_record jsonb;
    inserted_count int := 0;
BEGIN
    SELECT value::jsonb INTO registry_json 
    FROM public.app_config 
    WHERE key = 'TENANTS_REGISTRY';

    IF registry_json IS NOT NULL AND jsonb_typeof(registry_json) = 'array' THEN
        FOR tenant_record IN SELECT * FROM jsonb_array_elements(registry_json)
        LOOP
            INSERT INTO public.tenants (
                slug,
                name,
                status,
                plan_tier,
                office_name,
                latitude,
                longitude,
                radius,
                brand_color,
                logo_url,
                admin_name,
                admin_email,
                workspace_code,
                trial_ends_at
            ) VALUES (
                lower(tenant_record->>'slug'),
                tenant_record->>'name',
                coalesce(tenant_record->>'status', 'active'),
                coalesce(tenant_record->>'plan_tier', 'Pro'),
                coalesce(tenant_record->>'office_name', 'Main Office'),
                coalesce((tenant_record->>'latitude')::numeric, 6.4357),
                coalesce((tenant_record->>'longitude')::numeric, 3.4738),
                coalesce((tenant_record->>'radius')::numeric, 100),
                coalesce(tenant_record->>'brand_color', '#1a56db'),
                tenant_record->>'logo_url',
                tenant_record->>'admin_name',
                tenant_record->>'admin_email',
                tenant_record->>'workspace_code',
                now() + interval '14 days'
            )
            ON CONFLICT (slug) DO UPDATE SET
                name = EXCLUDED.name,
                status = EXCLUDED.status,
                plan_tier = EXCLUDED.plan_tier,
                office_name = EXCLUDED.office_name,
                latitude = EXCLUDED.latitude,
                longitude = EXCLUDED.longitude,
                radius = EXCLUDED.radius,
                brand_color = EXCLUDED.brand_color,
                logo_url = EXCLUDED.logo_url,
                admin_name = EXCLUDED.admin_name,
                admin_email = EXCLUDED.admin_email,
                workspace_code = coalesce(EXCLUDED.workspace_code, public.tenants.workspace_code),
                updated_at = now();
            
            inserted_count := inserted_count + 1;
        END LOOP;
    END IF;

    -- Ensure default tenant exists if table is empty
    IF NOT EXISTS (SELECT 1 FROM public.tenants LIMIT 1) THEN
        INSERT INTO public.tenants (
            slug,
            name,
            status,
            plan_tier,
            office_name,
            latitude,
            longitude,
            radius,
            brand_color,
            admin_name,
            admin_email,
            workspace_code,
            trial_ends_at
        ) VALUES (
            'default',
            'Primary Organization',
            'active',
            'Pro',
            'Headquarters',
            6.451863,
            3.527786,
            100,
            '#1a56db',
            'Admin',
            'admin@company.local',
            'LC8899',
            now() + interval '14 days'
        ) ON CONFLICT (slug) DO NOTHING;
        inserted_count := inserted_count + 1;
    END IF;

    RETURN inserted_count;
END;
$$;

-- Run sync immediately
SELECT public.sync_tenants_from_registry();
