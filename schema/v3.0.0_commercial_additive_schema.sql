-- ==============================================================================
-- Migration: v3.0.0 Commercial Additive Schema (Non-Breaking)
-- 
-- Safe for Live Production:
-- 1. Adds non-destructive columns with safe defaults to public.staff.
-- 2. Creates the organizations table for future multi-tenancy.
-- 3. Inserts default tenant config and company settings.
-- ==============================================================================

-- 1. Create organizations table (tenant registry)
CREATE TABLE IF NOT EXISTS public.organizations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text UNIQUE NOT NULL,
    name text NOT NULL,
    office_lat numeric DEFAULT 6.4518631,
    office_lon numeric DEFAULT 3.5277863,
    radius_meters numeric DEFAULT 100,
    late_cutoff_minutes int DEFAULT 540, -- 9:00 AM
    team_lead_priority boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);

-- Insert Default Organization if not exists
INSERT INTO public.organizations (id, slug, name, office_lat, office_lon, radius_meters, late_cutoff_minutes, team_lead_priority)
VALUES ('00000000-0000-0000-0000-000000000000', 'default', 'Primary Organization', 6.4518631, 3.5277863, 100, 540, true)
ON CONFLICT (id) DO NOTHING;

-- 2. Add additive columns to public.staff with backward-compatible defaults
ALTER TABLE public.staff 
    ADD COLUMN IF NOT EXISTS schedule_policy text DEFAULT 'weekly_hybrid',
    ADD COLUMN IF NOT EXISTS is_team_lead boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS include_in_reports boolean DEFAULT true,
    ADD COLUMN IF NOT EXISTS dept text DEFAULT 'General',
    ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000000';

-- 3. Add default config setting for team lead priority sorting in app_config
INSERT INTO public.app_config (key, value)
VALUES ('TEAM_LEAD_PRIORITY_SORT', 'true')
ON CONFLICT (key) DO NOTHING;

-- 4. Create an RPC to safely get staff with their policy details
CREATE OR REPLACE FUNCTION get_active_staff(p_tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000000')
RETURNS TABLE (
    name text,
    dept text,
    schedule_policy text,
    is_team_lead boolean,
    include_in_reports boolean,
    device_id text
) 
LANGUAGE sql
STABLE
AS $$
    SELECT 
        s.name,
        coalesce(s.dept, 'General') as dept,
        coalesce(s.schedule_policy, 'weekly_hybrid') as schedule_policy,
        coalesce(s.is_team_lead, false) as is_team_lead,
        coalesce(s.include_in_reports, true) as include_in_reports,
        s.device_id
    FROM public.staff s
    WHERE s.tenant_id = p_tenant_id OR s.tenant_id IS NULL
    ORDER BY 
        CASE WHEN s.is_team_lead THEN 0 ELSE 1 END,
        s.name ASC;
$$;
