-- Fix: the multi-row INSERT ... RETURNING into a single variable fails when >1 row.
-- Split the appointment insert so only the first row's id is captured.

CREATE OR REPLACE FUNCTION seed_workspace_demo_data(p_workspace_id uuid, p_owner_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_ids uuid[];
  v_cal_id uuid;
  v_cal2_id uuid;
  v_cal3_id uuid;
  v_form_id uuid;
  v_wf_id uuid;
  v_appt_id uuid;
BEGIN
  INSERT INTO contacts (workspace_id, first_name, last_name, email, phone, company, job_title, source, last_activity_at)
  VALUES
    (p_workspace_id, 'James', 'Carter', 'james.carter@email.com', '+1234567890', 'Carter & Associates', 'CEO', 'referral', now() - interval '2 days'),
    (p_workspace_id, 'Emily', 'Rodriguez', 'emily.r@email.com', '+1234567891', 'Rodriguez Law', 'Partner', 'website', now() - interval '5 days'),
    (p_workspace_id, 'Michael', 'Zhang', 'mzhang@email.com', '+1234567892', 'Zhang Tech', 'CTO', 'event', now() - interval '1 day'),
    (p_workspace_id, 'Jessica', 'Williams', 'jess.williams@email.com', '+1234567893', 'Williams Group', 'Director', 'referral', now() - interval '10 days'),
    (p_workspace_id, 'David', 'Kumar', 'david.kumar@email.com', '+1234567894', 'Kumar Consulting', 'Founder', 'website', now() - interval '3 days'),
    (p_workspace_id, 'Sarah', 'Johnson', 'sarah.j@email.com', '+1234567895', 'Johnson Capital', 'VP Finance', 'referral', now() - interval '7 days'),
    (p_workspace_id, 'Robert', 'Brown', 'robert.brown@email.com', '+1234567896', 'Brown Holdings', 'Chairman', 'event', now() - interval '30 days'),
    (p_workspace_id, 'Lisa', 'Anderson', 'lisa.a@email.com', '+1234567897', 'Anderson Media', 'CMO', 'website', now() - interval '4 days'),
    (p_workspace_id, 'Thomas', 'Lee', 'thomas.lee@email.com', '+1234567898', 'Lee Ventures', 'Investor', 'referral', now() - interval '14 days'),
    (p_workspace_id, 'Maria', 'Garcia', 'maria.garcia@email.com', '+1234567899', 'Garcia Design', 'Creative Director', 'website', now() - interval '1 day');

  v_contact_ids := ARRAY(SELECT id FROM contacts WHERE workspace_id = p_workspace_id ORDER BY created_at);

  INSERT INTO calendars (workspace_id, name, slug, description, color, duration_minutes, status, buffer_before_minutes, max_booking_horizon_days)
  VALUES (p_workspace_id, 'General Consultation', 'consultation', '30-minute consultation call', '#3B82F6', 30, 'active', 15, 30)
  RETURNING id INTO v_cal_id;

  INSERT INTO calendars (workspace_id, name, slug, description, color, duration_minutes, status, buffer_before_minutes, max_booking_horizon_days)
  VALUES (p_workspace_id, 'Strategy Session', 'strategy', '60-minute strategy session', '#10B981', 60, 'active', 30, 30)
  RETURNING id INTO v_cal2_id;

  INSERT INTO calendars (workspace_id, name, slug, description, color, duration_minutes, status, buffer_before_minutes, max_booking_horizon_days)
  VALUES (p_workspace_id, 'Group Workshop', 'workshop', '90-minute group workshop', '#F59E0B', 90, 'active', 0, 14)
  RETURNING id INTO v_cal3_id;

  -- First appointment (for recording link)
  INSERT INTO appointments (workspace_id, calendar_id, contact_id, title, status, start_time, end_time, notes)
  VALUES (p_workspace_id, v_cal_id, v_contact_ids[1], 'Initial Consultation', 'confirmed',
     date_trunc('day', now()) + interval '10 hours', date_trunc('day', now()) + interval '10 hours 30 minutes',
     'Discuss business goals and objectives.')
  RETURNING id INTO v_appt_id;

  -- Remaining appointments
  INSERT INTO appointments (workspace_id, calendar_id, contact_id, title, status, start_time, end_time, notes)
  VALUES
    (p_workspace_id, v_cal2_id, v_contact_ids[2], 'Strategy Planning', 'confirmed',
     date_trunc('day', now()) + interval '14 hours', date_trunc('day', now()) + interval '15 hours',
     'Q4 strategy review and planning session.'),
    (p_workspace_id, v_cal_id, v_contact_ids[3], 'Tech Review', 'pending',
     date_trunc('day', now()) + interval '16 hours', date_trunc('day', now()) + interval '16 hours 30 minutes',
     'Technical architecture review.'),
    (p_workspace_id, v_cal2_id, v_contact_ids[5], 'Partnership Discussion', 'confirmed',
     date_trunc('day', now()) + interval '1 day 11 hours', date_trunc('day', now()) + interval '1 day 12 hours',
     'Explore partnership opportunities.'),
    (p_workspace_id, v_cal3_id, v_contact_ids[6], 'Financial Planning Workshop', 'confirmed',
     date_trunc('day', now()) + interval '2 days 15 hours', date_trunc('day', now()) + interval '2 days 16 hours 30 minutes',
     'Group financial planning workshop.'),
    (p_workspace_id, v_cal_id, v_contact_ids[8], 'Brand Strategy Call', 'pending',
     date_trunc('day', now()) + interval '3 days 13 hours', date_trunc('day', now()) + interval '3 days 13 hours 30 minutes',
     'Discuss brand strategy and positioning.'),
    (p_workspace_id, v_cal2_id, v_contact_ids[9], 'Investment Review', 'confirmed',
     date_trunc('day', now()) + interval '4 days 10 hours', date_trunc('day', now()) + interval '4 days 11 hours',
     'Review investment portfolio and strategy.'),
    (p_workspace_id, v_cal_id, v_contact_ids[10], 'Design Consultation', 'confirmed',
     date_trunc('day', now()) + interval '5 days 15 hours', date_trunc('day', now()) + interval '5 days 15 hours 30 minutes',
     'Initial design consultation and scope review.'),
    (p_workspace_id, v_cal_id, v_contact_ids[4], 'Follow-up Call', 'completed',
     date_trunc('day', now()) - interval '1 day 14 hours', date_trunc('day', now()) - interval '1 day 14 hours 30 minutes',
     'Follow-up on previous discussion.'),
    (p_workspace_id, v_cal2_id, v_contact_ids[7], 'Portfolio Review', 'completed',
     date_trunc('day', now()) - interval '3 days 11 hours', date_trunc('day', now()) - interval '3 days 12 hours',
     'Annual portfolio review.');

  INSERT INTO forms (workspace_id, name, description, type, status, success_message, calendar_id)
  VALUES (p_workspace_id, 'Client Intake Form', 'Collect client information before consultation', 'form', 'published',
     'Thank you! We will be in touch shortly to confirm your appointment.', v_cal_id)
  RETURNING id INTO v_form_id;

  INSERT INTO forms (workspace_id, name, description, type, status, success_message, calendar_id)
  VALUES (p_workspace_id, 'Strategy Session Questionnaire', 'Pre-session questionnaire for strategy meetings', 'survey', 'published',
     'Thank you for completing the questionnaire. See you at the session!', v_cal2_id);

  INSERT INTO forms (workspace_id, name, description, type, status, success_message)
  VALUES (p_workspace_id, 'Feedback Survey', 'Post-appointment feedback survey', 'survey', 'draft',
     'Thank you for your feedback!');

  INSERT INTO form_fields (form_id, label, field_type, required, sort_order, mapped_field)
  VALUES
    (v_form_id, 'First Name', 'first_name', true, 0, 'first_name'),
    (v_form_id, 'Last Name', 'last_name', true, 1, 'last_name'),
    (v_form_id, 'Email', 'email', true, 2, 'email'),
    (v_form_id, 'Phone', 'phone', false, 3, 'phone'),
    (v_form_id, 'Company', 'company', false, 4, 'company'),
    (v_form_id, 'What brings you in today?', 'long_text', true, 5, null);

  INSERT INTO form_submissions (form_id, workspace_id, contact_id, answers)
  VALUES
    (v_form_id, p_workspace_id, v_contact_ids[1], '{"first_name": "James", "last_name": "Carter", "email": "james.carter@email.com", "company": "Carter & Associates", "What brings you in today?": "Looking for strategic consulting services"}'::jsonb),
    (v_form_id, p_workspace_id, v_contact_ids[2], '{"first_name": "Emily", "last_name": "Rodriguez", "email": "emily.r@email.com", "company": "Rodriguez Law", "What brings you in today?": "Need help with business strategy"}'::jsonb);

  INSERT INTO workflows (workspace_id, name, description, trigger_type, status, total_runs, last_run_at)
  VALUES (p_workspace_id, 'Welcome Email Sequence', 'Send a welcome email when a new contact is created', 'contact_created', 'active', 5, now() - interval '1 day')
  RETURNING id INTO v_wf_id;

  INSERT INTO workflows (workspace_id, name, description, trigger_type, status, total_runs, last_run_at)
  VALUES (p_workspace_id, 'Appointment Confirmation', 'Send confirmation email when appointment is booked', 'appointment_booked', 'active', 12, now() - interval '2 hours');

  INSERT INTO workflows (workspace_id, name, description, trigger_type, status, total_runs)
  VALUES (p_workspace_id, 'Follow-up Reminder', 'Send a follow-up email after appointment completion', 'appointment_completed', 'active', 8);

  INSERT INTO workflows (workspace_id, name, description, trigger_type, status, total_runs)
  VALUES (p_workspace_id, 'No-show Recovery', 'Send a rebooking link when a client no-shows', 'appointment_no_show', 'paused', 3);

  INSERT INTO workflows (workspace_id, name, description, trigger_type, status, total_runs)
  VALUES (p_workspace_id, 'Form Submission Alert', 'Notify when a form is submitted', 'form_submitted', 'draft', 0);

  INSERT INTO workflow_nodes (workflow_id, node_type, action_type, config, sort_order)
  VALUES
    (v_wf_id, 'action', 'send_email', '{"subject": "Welcome to Howells!", "template": "welcome"}'::jsonb, 0),
    (v_wf_id, 'delay', 'wait', '{"duration": "1 day"}'::jsonb, 1),
    (v_wf_id, 'action', 'add_tag', '{"tag": "onboarded"}'::jsonb, 2);

  INSERT INTO workflow_executions (workflow_id, status, started_at, completed_at)
  VALUES
    (v_wf_id, 'completed', now() - interval '1 day', now() - interval '1 day 1 minute'),
    (v_wf_id, 'completed', now() - interval '2 days', now() - interval '2 days 1 minute'),
    (v_wf_id, 'running', now() - interval '10 minutes', null);

  INSERT INTO recordings (workspace_id, appointment_id, title, status, duration_seconds, ai_summary, transcript, key_points, action_items)
  VALUES
    (p_workspace_id, v_appt_id, 'Initial Consultation - James Carter', 'ready', 1800,
     'James Carter discussed his company''s goals for the next quarter, focusing on strategic consulting services. Key topics included market expansion, operational efficiency, and team development.',
     'Speaker 1: Welcome James, thank you for joining today.\nSpeaker 2: Thanks for having me. I''m excited to discuss our goals.\nSpeaker 1: Let''s start with your current challenges...',
     '["Market expansion strategy for Q4", "Operational efficiency improvements", "Team development and hiring plans", "Budget allocation for consulting services"]'::jsonb,
     '[{"text": "Send proposal by Friday", "done": false}, {"text": "Schedule follow-up for next week", "done": true}]'::jsonb);

  INSERT INTO recordings (workspace_id, title, status, duration_seconds, ai_summary)
  VALUES (p_workspace_id, 'Strategy Planning - Emily Rodriguez', 'processing', 3600,
     'Emily Rodriguez reviewed Q4 strategy and discussed partnership opportunities. The session covered market analysis, competitive positioning, and growth targets.');

  INSERT INTO tags (workspace_id, name, color)
  VALUES
    (p_workspace_id, 'VIP', '#EF4444'),
    (p_workspace_id, 'Client', '#3B82F6'),
    (p_workspace_id, 'Prospect', '#10B981'),
    (p_workspace_id, 'Onboarded', '#F59E0B'),
    (p_workspace_id, 'Newsletter', '#8B5CF6');

  INSERT INTO notes (workspace_id, contact_id, content, author_id)
  VALUES
    (p_workspace_id, v_contact_ids[1], 'Had a great initial consultation. Very interested in our premium package.', p_owner_id),
    (p_workspace_id, v_contact_ids[2], 'Referred by James Carter. Looking for strategy consulting.', p_owner_id),
    (p_workspace_id, v_contact_ids[5], 'Discussed partnership opportunities. Follow up next week.', p_owner_id);

  INSERT INTO smart_lists (workspace_id, name, rules)
  VALUES
    (p_workspace_id, 'Active Clients', '{"status": "active"}'::jsonb),
    (p_workspace_id, 'Pending Follow-ups', '{"status": "pending"}'::jsonb);
END;
$$;

REVOKE EXECUTE ON FUNCTION seed_workspace_demo_data(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION seed_workspace_demo_data(uuid, uuid) TO authenticated;
