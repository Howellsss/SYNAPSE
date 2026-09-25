-- Create three test forms with distinct definitions
INSERT INTO forms (id, name, description, type, status, create_contact, update_contact, auto_tags, definition)
VALUES
  (
    '11111111-1111-1111-1111-111111111111',
    'General Consultation Form',
    'Please fill out this form before your consultation.',
    'form',
    'published',
    true,
    true,
    '[]'::jsonb,
    '{
      "version": 1,
      "pages": [{"id": "page-a1", "name": "Page 1", "sectionIds": ["sec-a1"], "visible": true}],
      "sections": {"sec-a1": {"id": "sec-a1", "name": "Section 1", "visible": true, "columnCount": 2, "elementIds": ["el-a1","el-a2","el-a3","el-a4","el-a5"]}},
      "elements": {
        "el-a1": {"id": "el-a1", "type": "first_name", "category": "fields", "displayLabel": "First Name", "sortOrder": 0, "column": 1, "field": {"fieldId": "fld-a1", "label": "First Name", "required": true, "visible": true, "placeholder": "John", "mappedContactField": "first_name"}},
        "el-a2": {"id": "el-a2", "type": "last_name", "category": "fields", "displayLabel": "Last Name", "sortOrder": 1, "column": 2, "field": {"fieldId": "fld-a2", "label": "Last Name", "required": true, "visible": true, "placeholder": "Doe", "mappedContactField": "last_name"}},
        "el-a3": {"id": "el-a3", "type": "email", "category": "fields", "displayLabel": "Email Address", "sortOrder": 2, "column": 1, "field": {"fieldId": "fld-a3", "label": "Email Address", "required": true, "visible": true, "placeholder": "john@example.com", "mappedContactField": "email"}},
        "el-a4": {"id": "el-a4", "type": "phone", "category": "fields", "displayLabel": "Phone Number", "sortOrder": 3, "column": 2, "field": {"fieldId": "fld-a4", "label": "Phone Number", "required": false, "visible": true, "placeholder": "+1 (555) 000-0000", "mappedContactField": "phone"}},
        "el-a5": {"id": "el-a5", "type": "long_text", "category": "fields", "displayLabel": "What would you like to discuss?", "sortOrder": 4, "column": 1, "field": {"fieldId": "fld-a5", "label": "What would you like to discuss?", "required": false, "visible": true, "placeholder": "Briefly describe what you would like to cover in the consultation."}}
      },
      "header": {"enabled": true, "showLogo": false, "showTitle": true, "showDescription": true, "showProgress": false},
      "footer": {"enabled": false, "content": ""},
      "theme": {
        "layoutPreset": "card", "maxFormWidth": "720px",
        "colors": {"surfaceBackground": "#ffffff", "heading": "#09132b", "bodyText": "#4a4a4a", "mutedText": "#9a9a9a", "border": "#e5e5e5", "primary": "#E4A93C", "background": "#ffffff"},
        "typography": {"primaryFont": "Inter, system-ui, sans-serif", "headingFont": "Playfair Display, Georgia, serif", "headingSize": "28px", "headingWeight": 700, "headingLineHeight": 1.2, "headingLetterSpacing": "0", "bodySize": "15px", "bodyLineHeight": 1.5, "buttonSize": "15px", "buttonWeight": 600},
        "layout": {"formWidth": "medium", "pagePadding": 32, "sectionSpacing": 24, "fieldSpacing": 16, "containerRadius": "xl", "containerShadow": "lg"},
        "fieldStyle": {"borderWidth": 1, "borderRadius": "md", "borderColor": "#d1d5db", "focusBorderColor": "#E4A93C", "backgroundColor": "#ffffff", "textColor": "#1a1a1a", "fontSize": "15px", "padding": "12px 16px"},
        "buttonStyle": {"style": "filled", "background": "#09132b", "textColor": "#ffffff", "border": "#09132b", "borderRadius": "lg", "height": 48, "padding": 24, "width": "full", "align": "center"},
        "split": {"leftWidth": 40, "rightWidth": 60, "columnGap": 0, "backgroundImage": null, "overlayOpacity": 0, "backgroundOverlay": "#000000", "contentAlign": "left"},
        "background": {"type": "color", "color": "#ffffff", "imageUrl": null, "imageSize": "cover", "imagePosition": "center", "overlayOpacity": 0, "overlayColor": "#000000"},
        "branding": {"logoUrl": null, "logoWidth": 200},
        "progress": {"show": true, "style": "bar", "color": "#E4A93C", "height": 6, "spacing": 16, "showLabels": true}
      },
      "logic": [],
      "settings": {"createContact": true, "updateContact": true, "autoTags": [], "successMessage": "Thank you for your submission.", "redirectUrl": null, "showProgressBar": false, "allowBackNavigation": true},
      "notifications": {
        "internal": {"enabled": false, "recipients": [], "channel": "email", "subject": "New Form Submission", "message": "A new form submission has been received.", "includeFields": [], "includeAllFields": true},
        "respondent": {"enabled": false, "emailFieldId": null, "subject": "Thank you for your submission", "senderName": "", "replyTo": "", "message": "We have received your information and will be in touch shortly.", "includeAnswers": "none", "includedFields": []},
        "postSubmission": {"type": "thank_you", "thankYouPage": {"heading": "Thank You!", "message": "Your submission has been received.", "imageUrl": null, "buttonText": null, "buttonLink": null}, "redirectUrl": null, "customMessage": ""}
      }
    }'::jsonb
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'Group Workshop Registration',
    'Register for our upcoming group workshop.',
    'form',
    'published',
    true,
    true,
    '[]'::jsonb,
    '{
      "version": 1,
      "pages": [{"id": "page-b1", "name": "Page 1", "sectionIds": ["sec-b1"], "visible": true}],
      "sections": {"sec-b1": {"id": "sec-b1", "name": "Section 1", "visible": true, "columnCount": 2, "elementIds": ["el-b1","el-b2","el-b3","el-b4","el-b5","el-b6"]}},
      "elements": {
        "el-b1": {"id": "el-b1", "type": "first_name", "category": "fields", "displayLabel": "First Name", "sortOrder": 0, "column": 1, "field": {"fieldId": "fld-b1", "label": "First Name", "required": true, "visible": true, "placeholder": "Jane", "mappedContactField": "first_name"}},
        "el-b2": {"id": "el-b2", "type": "last_name", "category": "fields", "displayLabel": "Last Name", "sortOrder": 1, "column": 2, "field": {"fieldId": "fld-b2", "label": "Last Name", "required": true, "visible": true, "placeholder": "Smith", "mappedContactField": "last_name"}},
        "el-b3": {"id": "el-b3", "type": "email", "category": "fields", "displayLabel": "Email Address", "sortOrder": 2, "column": 1, "field": {"fieldId": "fld-b3", "label": "Email Address", "required": true, "visible": true, "placeholder": "jane@example.com", "mappedContactField": "email"}},
        "el-b4": {"id": "el-b4", "type": "phone", "category": "fields", "displayLabel": "Phone Number", "sortOrder": 3, "column": 2, "field": {"fieldId": "fld-b4", "label": "Phone Number", "required": false, "visible": true, "placeholder": "+1 (555) 000-0000", "mappedContactField": "phone"}},
        "el-b5": {"id": "el-b5", "type": "text_field", "category": "fields", "displayLabel": "Organisation", "sortOrder": 4, "column": 1, "field": {"fieldId": "fld-b5", "label": "Organisation", "required": false, "visible": true, "placeholder": "Your organisation name"}},
        "el-b6": {"id": "el-b6", "type": "long_text", "category": "fields", "displayLabel": "What do you hope to learn?", "sortOrder": 5, "column": 1, "field": {"fieldId": "fld-b6", "label": "What do you hope to learn?", "required": false, "visible": true, "placeholder": "Tell us what you hope to gain from this workshop."}}
      },
      "header": {"enabled": true, "showLogo": false, "showTitle": true, "showDescription": true, "showProgress": false},
      "footer": {"enabled": false, "content": ""},
      "theme": {
        "layoutPreset": "card", "maxFormWidth": "720px",
        "colors": {"surfaceBackground": "#ffffff", "heading": "#09132b", "bodyText": "#4a4a4a", "mutedText": "#9a9a9a", "border": "#e5e5e5", "primary": "#E4A93C", "background": "#ffffff"},
        "typography": {"primaryFont": "Inter, system-ui, sans-serif", "headingFont": "Playfair Display, Georgia, serif", "headingSize": "28px", "headingWeight": 700, "headingLineHeight": 1.2, "headingLetterSpacing": "0", "bodySize": "15px", "bodyLineHeight": 1.5, "buttonSize": "15px", "buttonWeight": 600},
        "layout": {"formWidth": "medium", "pagePadding": 32, "sectionSpacing": 24, "fieldSpacing": 16, "containerRadius": "xl", "containerShadow": "lg"},
        "fieldStyle": {"borderWidth": 1, "borderRadius": "md", "borderColor": "#d1d5db", "focusBorderColor": "#E4A93C", "backgroundColor": "#ffffff", "textColor": "#1a1a1a", "fontSize": "15px", "padding": "12px 16px"},
        "buttonStyle": {"style": "filled", "background": "#09132b", "textColor": "#ffffff", "border": "#09132b", "borderRadius": "lg", "height": 48, "padding": 24, "width": "full", "align": "center"},
        "split": {"leftWidth": 40, "rightWidth": 60, "columnGap": 0, "backgroundImage": null, "overlayOpacity": 0, "backgroundOverlay": "#000000", "contentAlign": "left"},
        "background": {"type": "color", "color": "#ffffff", "imageUrl": null, "imageSize": "cover", "imagePosition": "center", "overlayOpacity": 0, "overlayColor": "#000000"},
        "branding": {"logoUrl": null, "logoWidth": 200},
        "progress": {"show": true, "style": "bar", "color": "#E4A93C", "height": 6, "spacing": 16, "showLabels": true}
      },
      "logic": [],
      "settings": {"createContact": true, "updateContact": true, "autoTags": [], "successMessage": "Thank you for your registration.", "redirectUrl": null, "showProgressBar": false, "allowBackNavigation": true},
      "notifications": {
        "internal": {"enabled": false, "recipients": [], "channel": "email", "subject": "New Form Submission", "message": "A new form submission has been received.", "includeFields": [], "includeAllFields": true},
        "respondent": {"enabled": false, "emailFieldId": null, "subject": "Thank you for your submission", "senderName": "", "replyTo": "", "message": "We have received your information and will be in touch shortly.", "includeAnswers": "none", "includedFields": []},
        "postSubmission": {"type": "thank_you", "thankYouPage": {"heading": "Thank You!", "message": "Your registration has been received.", "imageUrl": null, "buttonText": null, "buttonLink": null}, "redirectUrl": null, "customMessage": ""}
      }
    }'::jsonb
  ),
  (
    '33333333-3333-3333-3333-333333333333',
    'Strategy Session Application',
    'Apply for a strategy session with our team.',
    'form',
    'published',
    true,
    true,
    '[]'::jsonb,
    '{
      "version": 1,
      "pages": [{"id": "page-c1", "name": "Page 1", "sectionIds": ["sec-c1"], "visible": true}],
      "sections": {"sec-c1": {"id": "sec-c1", "name": "Section 1", "visible": true, "columnCount": 2, "elementIds": ["el-c1","el-c2","el-c3","el-c4","el-c5","el-c6","el-c7"]}},
      "elements": {
        "el-c1": {"id": "el-c1", "type": "first_name", "category": "fields", "displayLabel": "First Name", "sortOrder": 0, "column": 1, "field": {"fieldId": "fld-c1", "label": "First Name", "required": true, "visible": true, "placeholder": "Alex", "mappedContactField": "first_name"}},
        "el-c2": {"id": "el-c2", "type": "last_name", "category": "fields", "displayLabel": "Last Name", "sortOrder": 1, "column": 2, "field": {"fieldId": "fld-c2", "label": "Last Name", "required": true, "visible": true, "placeholder": "Johnson", "mappedContactField": "last_name"}},
        "el-c3": {"id": "el-c3", "type": "email", "category": "fields", "displayLabel": "Email Address", "sortOrder": 2, "column": 1, "field": {"fieldId": "fld-c3", "label": "Email Address", "required": true, "visible": true, "placeholder": "alex@example.com", "mappedContactField": "email"}},
        "el-c4": {"id": "el-c4", "type": "phone", "category": "fields", "displayLabel": "Phone Number", "sortOrder": 3, "column": 2, "field": {"fieldId": "fld-c4", "label": "Phone Number", "required": false, "visible": true, "placeholder": "+1 (555) 000-0000", "mappedContactField": "phone"}},
        "el-c5": {"id": "el-c5", "type": "text_field", "category": "fields", "displayLabel": "Company", "sortOrder": 4, "column": 1, "field": {"fieldId": "fld-c5", "label": "Company", "required": true, "visible": true, "placeholder": "Your company name"}},
        "el-c6": {"id": "el-c6", "type": "text_field", "category": "fields", "displayLabel": "Role", "sortOrder": 5, "column": 2, "field": {"fieldId": "fld-c6", "label": "Role", "required": false, "visible": true, "placeholder": "Your job title"}},
        "el-c7": {"id": "el-c7", "type": "long_text", "category": "fields", "displayLabel": "What challenge are you facing?", "sortOrder": 6, "column": 1, "field": {"fieldId": "fld-c7", "label": "What challenge are you facing?", "required": true, "visible": true, "placeholder": "Describe the strategic challenge you would like to discuss."}}
      },
      "header": {"enabled": true, "showLogo": false, "showTitle": true, "showDescription": true, "showProgress": false},
      "footer": {"enabled": false, "content": ""},
      "theme": {
        "layoutPreset": "card", "maxFormWidth": "720px",
        "colors": {"surfaceBackground": "#ffffff", "heading": "#09132b", "bodyText": "#4a4a4a", "mutedText": "#9a9a9a", "border": "#e5e5e5", "primary": "#E4A93C", "background": "#ffffff"},
        "typography": {"primaryFont": "Inter, system-ui, sans-serif", "headingFont": "Playfair Display, Georgia, serif", "headingSize": "28px", "headingWeight": 700, "headingLineHeight": 1.2, "headingLetterSpacing": "0", "bodySize": "15px", "bodyLineHeight": 1.5, "buttonSize": "15px", "buttonWeight": 600},
        "layout": {"formWidth": "medium", "pagePadding": 32, "sectionSpacing": 24, "fieldSpacing": 16, "containerRadius": "xl", "containerShadow": "lg"},
        "fieldStyle": {"borderWidth": 1, "borderRadius": "md", "borderColor": "#d1d5db", "focusBorderColor": "#E4A93C", "backgroundColor": "#ffffff", "textColor": "#1a1a1a", "fontSize": "15px", "padding": "12px 16px"},
        "buttonStyle": {"style": "filled", "background": "#09132b", "textColor": "#ffffff", "border": "#09132b", "borderRadius": "lg", "height": 48, "padding": 24, "width": "full", "align": "center"},
        "split": {"leftWidth": 40, "rightWidth": 60, "columnGap": 0, "backgroundImage": null, "overlayOpacity": 0, "backgroundOverlay": "#000000", "contentAlign": "left"},
        "background": {"type": "color", "color": "#ffffff", "imageUrl": null, "imageSize": "cover", "imagePosition": "center", "overlayOpacity": 0, "overlayColor": "#000000"},
        "branding": {"logoUrl": null, "logoWidth": 200},
        "progress": {"show": true, "style": "bar", "color": "#E4A93C", "height": 6, "spacing": 16, "showLabels": true}
      },
      "logic": [],
      "settings": {"createContact": true, "updateContact": true, "autoTags": [], "successMessage": "Thank you for your application.", "redirectUrl": null, "showProgressBar": false, "allowBackNavigation": true},
      "notifications": {
        "internal": {"enabled": false, "recipients": [], "channel": "email", "subject": "New Form Submission", "message": "A new form submission has been received.", "includeFields": [], "includeAllFields": true},
        "respondent": {"enabled": false, "emailFieldId": null, "subject": "Thank you for your submission", "senderName": "", "replyTo": "", "message": "We have received your information and will be in touch shortly.", "includeAnswers": "none", "includedFields": []},
        "postSubmission": {"type": "thank_you", "thankYouPage": {"heading": "Thank You!", "message": "Your application has been received.", "imageUrl": null, "buttonText": null, "buttonLink": null}, "redirectUrl": null, "customMessage": ""}
      }
    }'::jsonb
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  definition = EXCLUDED.definition,
  status = EXCLUDED.status;

-- Create three test calendars (valid hex UUIDs)
INSERT INTO calendars (id, name, slug, description, calendar_type, duration_minutes, slot_interval_minutes, location_type, status, booking_flow, connected_form_id, color, background_color, button_color, font_family, timezone, max_booking_horizon_days, min_booking_notice_minutes)
VALUES
  ('0c100000-0000-0000-0000-000000000001', 'General Consultation', 'general-consultation', '30-minute consultation call', 'one_on_one', 30, 30, 'synapse_meeting', 'active', 'form_first', '11111111-1111-1111-1111-111111111111', '#E4A93C', '#09132b', '#E4A93C', 'Inter', 'UTC', 30, 60),
  ('0c100000-0000-0000-0000-000000000002', 'Group Workshop', 'group-workshop', 'Interactive group workshop session', 'group', 90, 30, 'synapse_meeting', 'active', 'form_first', '22222222-2222-2222-2222-222222222222', '#E4A93C', '#09132b', '#E4A93C', 'Inter', 'UTC', 30, 60),
  ('0c100000-0000-0000-0000-000000000003', 'Strategy Session', 'strategy-session', 'Strategic planning session with our team', 'one_on_one', 60, 30, 'synapse_meeting', 'active', 'form_first', '33333333-3333-3333-3333-333333333333', '#E4A93C', '#09132b', '#E4A93C', 'Inter', 'UTC', 30, 60)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  slug = EXCLUDED.slug,
  description = EXCLUDED.description,
  connected_form_id = EXCLUDED.connected_form_id,
  booking_flow = EXCLUDED.booking_flow,
  status = EXCLUDED.status,
  background_color = EXCLUDED.background_color;

-- Create the group calendar
INSERT INTO calendar_groups (id, name, slug, description, is_active, primary_color, background_color, button_color, font_family, layout, booking_flow)
VALUES
  ('0e100000-0000-0000-0000-000000000001', 'SYNAPSE Booking', 'synapse-booking', 'Book a session with our team. Choose a service above, fill out the form, and select a time that works for you.', true, '#E4A93C', '#09132b', '#E4A93C', 'Inter', 'grid', 'form_first')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  slug = EXCLUDED.slug,
  description = EXCLUDED.description,
  is_active = EXCLUDED.is_active,
  primary_color = EXCLUDED.primary_color,
  background_color = EXCLUDED.background_color,
  button_color = EXCLUDED.button_color,
  booking_flow = EXCLUDED.booking_flow;

-- Link calendars to the group
INSERT INTO calendar_group_members (group_id, calendar_id, sort_order)
VALUES
  ('0e100000-0000-0000-0000-000000000001', '0c100000-0000-0000-0000-000000000001', 0),
  ('0e100000-0000-0000-0000-000000000001', '0c100000-0000-0000-0000-000000000002', 1),
  ('0e100000-0000-0000-0000-000000000001', '0c100000-0000-0000-0000-000000000003', 2)
ON CONFLICT DO NOTHING;
