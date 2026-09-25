/*
# Update form fields for Pastor Tolu group booking tabs

1. Changes
   - Updates Counseling Intake Form fields to match spec: Full Name, Primary Contact Email,
     Relationship Status (Single/Courting/Married), What Would You Like Guidance On?
   - Updates Corporate Consulting Inquiry fields to match spec: Company or Brand Name, Industry,
     Consultation Core Target (dropdown), Message Details
   - Updates General Contact Form fields to match spec: Your Name, Your Email, Subject, Message
2. Security
   - No RLS changes needed
3. Notes
   - Form submissions (form_submissions table) store answers as JSON, so existing submissions
     are not affected by changing form field definitions
   - The counseling form uses field_type 'first_name' for Full Name so contact extraction still works
*/

-- Delete existing form fields for the three forms
DELETE FROM form_fields 
WHERE form_id IN (
  'bb221ac5-b255-424f-a119-b9871bb8ed19',  -- Counseling Intake Form
  'c7515303-0587-4923-b649-bf008abcc60e',  -- Corporate Consulting Inquiry
  '11150458-7ab1-4fd5-9ecf-7be5cf0a76ce'   -- General Contact Form
);

-- Counseling Intake Form (matches spec: Full Name, Primary Contact Email, Relationship Status, What Would You Like Guidance On?)
INSERT INTO form_fields (form_id, label, field_type, sort_order, required, placeholder, options, help_text, mapped_field)
VALUES
  ('bb221ac5-b255-424f-a119-b9871bb8ed19', 'Full Name', 'first_name', 0, true, 'Enter your full name', NULL, NULL, 'first_name'),
  ('bb221ac5-b255-424f-a119-b9871bb8ed19', 'Primary Contact Email', 'email', 1, true, 'you@example.com', NULL, NULL, 'email'),
  ('bb221ac5-b255-424f-a119-b9871bb8ed19', 'Relationship Status', 'radio', 2, true, NULL, '["Single","Courting","Married"]', NULL, NULL),
  ('bb221ac5-b255-424f-a119-b9871bb8ed19', 'What Would You Like Guidance On?', 'long_text', 3, true, 'Share what you would like guidance on...', NULL, NULL, NULL);

-- Corporate Consulting Inquiry (matches spec: Company or Brand Name, Industry, Consultation Core Target, Message Details)
INSERT INTO form_fields (form_id, label, field_type, sort_order, required, placeholder, options, help_text, mapped_field)
VALUES
  ('c7515303-0587-4923-b649-bf008abcc60e', 'Company or Brand Name', 'text', 0, true, 'Enter company or brand name', NULL, NULL, NULL),
  ('c7515303-0587-4923-b649-bf008abcc60e', 'Industry', 'text', 1, true, 'e.g. Technology, Finance, Healthcare', NULL, NULL, NULL),
  ('c7515303-0587-4923-b649-bf008abcc60e', 'Consultation Core Target', 'dropdown', 2, true, NULL, '["Leadership Development","Strategic Planning","Team Building","Organizational Culture","Brand Strategy","Other"]', NULL, NULL),
  ('c7515303-0587-4923-b649-bf008abcc60e', 'Message Details', 'long_text', 3, true, 'Tell us about your consulting needs...', NULL, NULL, NULL),
  ('c7515303-0587-4923-b649-bf008abcc60e', 'Contact Email', 'email', 4, true, 'you@company.com', NULL, NULL, 'email');

-- General Contact Form (matches spec: Your Name, Your Email, Subject, Message)
INSERT INTO form_fields (form_id, label, field_type, sort_order, required, placeholder, options, help_text, mapped_field)
VALUES
  ('11150458-7ab1-4fd5-9ecf-7be5cf0a76ce', 'Your Name', 'first_name', 0, true, 'Enter your name', NULL, NULL, 'first_name'),
  ('11150458-7ab1-4fd5-9ecf-7be5cf0a76ce', 'Your Email', 'email', 1, true, 'you@example.com', NULL, NULL, 'email'),
  ('11150458-7ab1-4fd5-9ecf-7be5cf0a76ce', 'Subject', 'text', 2, true, 'What is this about?', NULL, NULL, NULL),
  ('11150458-7ab1-4fd5-9ecf-7be5cf0a76ce', 'Message', 'long_text', 3, true, 'How can we help you?', NULL, NULL, NULL);
