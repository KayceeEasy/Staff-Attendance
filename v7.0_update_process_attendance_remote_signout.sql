-- ==============================================================================
-- Function: process_attendance (v7.0 - Post-Closing Remote Sign-Out Support)
-- 
-- Summary:
-- 1. Preserves WFH virtual sign-in on scheduled Home days.
-- 2. Strictly enforces office geofence on Office days during workday hours.
-- 3. POST-CLOSING REMOTE SIGN-OUT:
--    Allows staff to sign out (action = 'OUT') remotely without office GPS
--    after the tenant's configured closing time (e.g. 5:00 PM),
--    PROVIDED they already recorded a valid, verified 'IN' attendance earlier today.
--    Tagged as 'Off-Site Sign-Out' for clear management audit trails.
-- 4. Rejects remote sign-outs if employee never signed in today.
-- ==============================================================================

CREATE OR REPLACE FUNCTION process_attendance(
    p_name text,
    p_action text,
    p_lat numeric,
    p_lon numeric,
    p_device_id text,
    p_timezone_offset interval DEFAULT interval '1 hour'
)
RETURNS json AS $$
DECLARE
    v_office_lat numeric;
    v_office_lon numeric;
    v_radius numeric;
    v_late_cutoff numeric;
    v_closing_minutes numeric;
    v_allow_remote_signout text;
    v_distance numeric;
    v_staff record;
    v_date text;
    v_time text;
    v_hour int;
    v_now_minutes int;
    v_has_signed_in boolean;
    v_has_signed_out boolean;
    v_status text;
    v_log_status text;
    v_greeting text;
    v_now timestamp with time zone;
    v_last_log record;
    v_missed_out_time timestamp with time zone;
    v_day_name text;
    v_is_wfh boolean := false;
    v_is_post_closing_remote_signout boolean := false;
    v_schedule_row jsonb;
    v_staff_key text;
    v_location_val text;
BEGIN
    v_now := now() AT TIME ZONE 'UTC' + p_timezone_offset;
    v_date := to_char(v_now, 'DD/MM/YYYY');
    v_time := to_char(v_now, 'HH12:MI AM');
    v_hour := extract(hour from v_now);
    v_now_minutes := (v_hour * 60) + extract(minute from v_now);
    v_day_name := trim(to_char(v_now, 'Day'));

    -- 1. Load configuration
    SELECT value::numeric INTO v_office_lat FROM public.app_config WHERE key = 'OFFICE_LAT';
    SELECT value::numeric INTO v_office_lon FROM public.app_config WHERE key = 'OFFICE_LON';
    SELECT value::numeric INTO v_radius FROM public.app_config WHERE key = 'RADIUS_METERS';
    SELECT value::numeric INTO v_late_cutoff FROM public.app_config WHERE key = 'LATE_CUTOFF_MINUTES';
    SELECT value::numeric INTO v_closing_minutes FROM public.app_config WHERE key = 'WORKDAY_END_MINUTES';
    SELECT value INTO v_allow_remote_signout FROM public.app_config WHERE key = 'ALLOW_REMOTE_SIGNOUT_POST_CLOSING';

    -- Default fallbacks if configs missing
    IF v_late_cutoff IS NULL THEN v_late_cutoff := 540; END IF; -- 9:00 AM
    IF v_closing_minutes IS NULL THEN v_closing_minutes := 1020; END IF; -- 5:00 PM (17:00)
    IF v_allow_remote_signout IS NULL THEN v_allow_remote_signout := 'true'; END IF;
    IF v_radius IS NULL THEN v_radius := 100; END IF;

    -- 2. Verify staff exists and check device lock
    SELECT * INTO v_staff FROM public.staff WHERE lower(trim(name)) = lower(trim(p_name));
    IF NOT FOUND THEN
        RETURN json_build_object('ok', false, 'status', 'DENIED', 'message', 'Staff member not recognized. Contact your administrator.');
    END IF;

    IF v_staff.device_id IS NOT NULL AND v_staff.device_id != '' AND v_staff.device_id != p_device_id THEN
        RETURN json_build_object('ok', false, 'status', 'DENIED', 'message', 'Device mismatch. This account is locked to a different phone.');
    END IF;

    -- Register device if not locked
    IF v_staff.device_id IS NULL OR v_staff.device_id = '' THEN
        UPDATE public.staff SET device_id = p_device_id WHERE lower(trim(name)) = lower(trim(p_name));
    END IF;

    -- 3. Check Hybrid Schedule for Today
    SELECT schedule_data::jsonb INTO v_schedule_row
    FROM public.hybrid_schedules
    ORDER BY timestamp DESC
    LIMIT 1;

    IF v_schedule_row IS NOT NULL THEN
        FOR v_staff_key IN SELECT jsonb_object_keys(v_schedule_row)
        LOOP
            IF lower(trim(v_staff_key)) = lower(trim(p_name)) OR position(lower(trim(p_name)) in lower(trim(v_staff_key))) > 0 THEN
                v_location_val := v_schedule_row -> v_staff_key ->> v_day_name;
                IF v_location_val IS NULL THEN
                    v_location_val := v_schedule_row -> v_staff_key ->> lower(v_day_name);
                END IF;
                IF lower(trim(coalesce(v_location_val, ''))) = 'home' THEN
                    v_is_wfh := true;
                END IF;
                EXIT;
            END IF;
        END LOOP;
    END IF;

    -- 4. Check if already signed in/out today
    SELECT EXISTS(SELECT 1 FROM public.attendance_logs WHERE lower(trim(name)) = lower(trim(p_name)) AND date = v_date AND action = 'IN') INTO v_has_signed_in;
    SELECT EXISTS(SELECT 1 FROM public.attendance_logs WHERE lower(trim(name)) = lower(trim(p_name)) AND date = v_date AND action = 'OUT') INTO v_has_signed_out;

    IF p_action = 'IN' AND v_has_signed_in THEN
        RETURN json_build_object('ok', false, 'status', 'DENIED', 'message', 'You have already signed in for today.');
    END IF;

    IF p_action = 'OUT' AND v_has_signed_out THEN
        RETURN json_build_object('ok', false, 'status', 'DENIED', 'message', 'You have already signed out for today.');
    END IF;

    IF p_action = 'OUT' AND NOT v_has_signed_in THEN
        RETURN json_build_object('ok', false, 'status', 'DENIED', 'message', 'You cannot sign out without signing in first.');
    END IF;

    -- 5. Check Post-Closing Remote Sign-Out Eligibility
    IF p_action = 'OUT' AND v_has_signed_in AND v_now_minutes >= v_closing_minutes AND (v_allow_remote_signout = 'true' OR v_allow_remote_signout = '1') THEN
        v_is_post_closing_remote_signout := true;
    END IF;

    -- 6. Calculate Distance & Enforce Geofence (Bypassed for WFH or Post-Closing Sign-Out)
    IF p_lat IS NOT NULL AND p_lon IS NOT NULL AND (p_lat != 0 OR p_lon != 0) AND v_office_lat IS NOT NULL AND v_office_lon IS NOT NULL THEN
        v_distance := public.haversine_distance(v_office_lat, v_office_lon, p_lat, p_lon);
    ELSE
        v_distance := 0;
    END IF;
    
    IF NOT v_is_wfh AND NOT v_is_post_closing_remote_signout AND (v_distance > v_radius OR p_lat IS NULL OR p_lon IS NULL OR (p_lat = 0 AND p_lon = 0)) THEN
        INSERT INTO public.distance_alerts (date, time, name, action, distance, lat, lon)
        VALUES (v_date, v_time, p_name, p_action, round(coalesce(v_distance, 0))::text, coalesce(p_lat, 0), coalesce(p_lon, 0));
        
        RETURN json_build_object(
            'ok', false, 
            'status', 'DENIED', 
            'message', 'Denied. You are too far from the office (' || round(coalesce(v_distance, 0))::text || ' meters).', 
            'distance', round(coalesce(v_distance, 0))::text
        );
    END IF;

    -- 7. Auto-sign out for a missed previous day
    IF p_action = 'IN' THEN
        SELECT * INTO v_last_log FROM public.attendance_logs 
        WHERE lower(trim(name)) = lower(trim(p_name)) 
        ORDER BY created_at DESC LIMIT 1;

        IF FOUND AND v_last_log.action = 'IN' AND v_last_log.date != v_date THEN
            v_missed_out_time := date_trunc('day', v_last_log.created_at) + interval '23 hours 59 minutes';
            
            INSERT INTO public.attendance_logs (date, name, action, time, status, distance, lat, lon, created_at)
            VALUES (v_last_log.date, p_name, 'OUT', '11:59 PM', 'Missed', '0', coalesce(p_lat, 0), coalesce(p_lon, 0), v_missed_out_time);
        END IF;
    END IF;

    -- 8. Determine status and greeting
    IF p_action = 'IN' THEN
        IF v_now_minutes < v_late_cutoff THEN
            v_status := 'WELCOME';
            v_log_status := 'On Time';
            IF v_is_wfh THEN
                v_greeting := 'Virtual Sign-In Successful, ' || p_name || '. Have a productive day at home!';
            ELSE
                v_greeting := 'Welcome, ' || p_name || '. Have a productive day ahead!';
            END IF;
        ELSE
            v_status := 'LATE';
            v_log_status := 'Late';
            IF v_is_wfh THEN
                v_greeting := 'Hi ' || p_name || ', Virtual Sign-In recorded (Late). Let’s dive in.';
            ELSE
                v_greeting := 'Hi, ' || p_name || '. We''re behind schedule today. Let’s dive in.';
            END IF;
        END IF;
    ELSE
        -- OUT action
        v_status := 'GOODBYE';
        IF v_is_post_closing_remote_signout THEN
            v_log_status := 'Off-Site Sign-Out';
            v_greeting := 'Goodbye, ' || p_name || '. Remote sign-out recorded. Have a great evening!';
        ELSIF v_is_wfh THEN
            v_log_status := 'WFH Sign-Out';
            v_greeting := 'Goodbye, ' || p_name || '. Virtual sign-out recorded. Have a wonderful evening!';
        ELSE
            v_log_status := 'Signed Out';
            v_greeting := 'Goodbye, ' || p_name || '. Have a safe trip home!';
        END IF;
    END IF;

    -- 9. Insert attendance record
    INSERT INTO public.attendance_logs (date, name, action, time, status, distance, lat, lon, created_at)
    VALUES (v_date, p_name, p_action, v_time, v_log_status, round(coalesce(v_distance, 0))::text, coalesce(p_lat, 0), coalesce(p_lon, 0), v_now);

    RETURN json_build_object(
        'ok', true,
        'status', v_status,
        'message', v_greeting,
        'date', v_date,
        'time', v_time,
        'distance', round(coalesce(v_distance, 0))::text
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
