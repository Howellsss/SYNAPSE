import type { FormFieldType } from '@/types';

export interface TemplateField {
  label: string;
  field_type: FormFieldType;
  required: boolean;
  placeholder?: string;
  help_text?: string;
  options?: string[];
  mapped_field?: string | null;
}

export interface FormTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  type: 'form' | 'survey' | 'both';
  fields: TemplateField[];
}

export type TemplateCategory =
  | 'Business'
  | 'Registration'
  | 'Feedback'
  | 'Applications'
  | 'Events'
  | 'Client Intake'
  | 'Marketing'
  | 'HR'
  | 'Education'
  | 'Other';

export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  'Business',
  'Registration',
  'Feedback',
  'Applications',
  'Events',
  'Client Intake',
  'Marketing',
  'HR',
  'Education',
  'Other',
];

export const DEFAULT_CONTACT_FIELDS: TemplateField[] = [
  { label: 'First Name', field_type: 'first_name', required: true, placeholder: 'John', mapped_field: 'first_name' },
  { label: 'Last Name', field_type: 'last_name', required: true, placeholder: 'Doe', mapped_field: 'last_name' },
  { label: 'Phone Number', field_type: 'phone', required: false, placeholder: '+1 (555) 000-0000', mapped_field: 'phone' },
  { label: 'Email Address', field_type: 'email', required: true, placeholder: 'john@example.com', mapped_field: 'email' },
  {
    label: 'Consent',
    field_type: 'consent',
    required: true,
    help_text: 'I agree to be contacted regarding my submission.',
  },
];

export const FORM_TEMPLATES: FormTemplate[] = [
  {
    id: 'client-intake',
    name: 'Client Intake Form',
    description: 'Collect client details before your first consultation.',
    category: 'Client Intake',
    type: 'form',
    fields: [
      { label: 'First Name', field_type: 'first_name', required: true, placeholder: 'John', mapped_field: 'first_name' },
      { label: 'Last Name', field_type: 'last_name', required: true, placeholder: 'Doe', mapped_field: 'last_name' },
      { label: 'Email Address', field_type: 'email', required: true, placeholder: 'john@example.com', mapped_field: 'email' },
      { label: 'Phone Number', field_type: 'phone', required: true, placeholder: '+1 (555) 000-0000', mapped_field: 'phone' },
      { label: 'Company Name', field_type: 'text', required: false, placeholder: 'Acme Inc.' },
      { label: 'What brings you in today?', field_type: 'long_text', required: true, placeholder: 'Describe your goals...' },
      {
        label: 'Preferred Communication',
        field_type: 'radio',
        required: true,
        options: ['Email', 'Phone', 'Text Message'],
      },
      {
        label: 'Consent',
        field_type: 'consent',
        required: true,
        help_text: 'I agree to be contacted regarding my submission.',
      },
    ],
  },
  {
    id: 'contact-form',
    name: 'Contact Form',
    description: 'General purpose contact form for your website.',
    category: 'Business',
    type: 'form',
    fields: [
      { label: 'Full Name', field_type: 'text', required: true, placeholder: 'Jane Smith' },
      { label: 'Email Address', field_type: 'email', required: true, placeholder: 'jane@example.com', mapped_field: 'email' },
      { label: 'Phone Number', field_type: 'phone', required: false, placeholder: '+1 (555) 000-0000' },
      { label: 'Subject', field_type: 'text', required: true, placeholder: 'How can we help?' },
      { label: 'Message', field_type: 'long_text', required: true, placeholder: 'Tell us more...' },
    ],
  },
  {
    id: 'event-registration',
    name: 'Event Registration',
    description: 'Register attendees for an event or webinar.',
    category: 'Events',
    type: 'form',
    fields: [
      { label: 'First Name', field_type: 'first_name', required: true, placeholder: 'John', mapped_field: 'first_name' },
      { label: 'Last Name', field_type: 'last_name', required: true, placeholder: 'Doe', mapped_field: 'last_name' },
      { label: 'Email Address', field_type: 'email', required: true, placeholder: 'john@example.com', mapped_field: 'email' },
      { label: 'Phone Number', field_type: 'phone', required: false, placeholder: '+1 (555) 000-0000' },
      { label: 'Company', field_type: 'text', required: false, placeholder: 'Acme Inc.' },
      { label: 'Number of Guests', field_type: 'number', required: true, placeholder: '1' },
      {
        label: 'Dietary Restrictions',
        field_type: 'dropdown',
        required: false,
        options: ['None', 'Vegetarian', 'Vegan', 'Gluten-Free', 'Halal', 'Kosher', 'Other'],
      },
      {
        label: 'Consent',
        field_type: 'consent',
        required: true,
        help_text: 'I agree to receive event updates and reminders.',
      },
    ],
  },
  {
    id: 'lead-capture',
    name: 'Lead Capture Form',
    description: 'Capture qualified leads from your landing pages.',
    category: 'Marketing',
    type: 'form',
    fields: [
      { label: 'Full Name', field_type: 'text', required: true, placeholder: 'Jane Smith' },
      { label: 'Work Email', field_type: 'email', required: true, placeholder: 'jane@company.com', mapped_field: 'email' },
      { label: 'Phone Number', field_type: 'phone', required: false, placeholder: '+1 (555) 000-0000' },
      { label: 'Company', field_type: 'text', required: true, placeholder: 'Company name' },
      {
        label: 'Company Size',
        field_type: 'dropdown',
        required: true,
        options: ['1-10', '11-50', '51-200', '201-500', '500+'],
      },
      {
        label: 'What are you looking for?',
        field_type: 'radio',
        required: true,
        options: ['Product Demo', 'Pricing Information', 'Partnership', 'General Inquiry'],
      },
    ],
  },
  {
    id: 'feedback-survey',
    name: 'Feedback Survey',
    description: 'Gather feedback after a meeting or event.',
    category: 'Feedback',
    type: 'survey',
    fields: [
      { label: 'Full Name', field_type: 'text', required: false, placeholder: 'Optional' },
      { label: 'Email Address', field_type: 'email', required: false, placeholder: 'Optional', mapped_field: 'email' },
      {
        label: 'How satisfied were you with the event?',
        field_type: 'radio',
        required: true,
        options: ['Very Satisfied', 'Satisfied', 'Neutral', 'Dissatisfied', 'Very Dissatisfied'],
      },
      {
        label: 'How would you rate the content?',
        field_type: 'dropdown',
        required: true,
        options: ['Excellent', 'Good', 'Average', 'Below Average', 'Poor'],
      },
      {
        label: 'What did you enjoy most?',
        field_type: 'long_text',
        required: false,
        placeholder: 'Share your thoughts...',
      },
      {
        label: 'What could we improve?',
        field_type: 'long_text',
        required: false,
        placeholder: 'Your feedback helps us grow',
      },
      {
        label: 'Would you attend another event?',
        field_type: 'radio',
        required: true,
        options: ['Yes', 'Maybe', 'No'],
      },
    ],
  },
  {
    id: 'customer-satisfaction',
    name: 'Customer Satisfaction (CSAT)',
    description: 'Measure customer satisfaction with rating questions.',
    category: 'Feedback',
    type: 'survey',
    fields: [
      { label: 'Customer Name', field_type: 'text', required: false, placeholder: 'Optional' },
      { label: 'Email', field_type: 'email', required: false, placeholder: 'Optional', mapped_field: 'email' },
      {
        label: 'How satisfied are you with our service?',
        field_type: 'radio',
        required: true,
        options: ['1 - Very Unsatisfied', '2 - Unsatisfied', '3 - Neutral', '4 - Satisfied', '5 - Very Satisfied'],
      },
      {
        label: 'How likely are you to recommend us?',
        field_type: 'radio',
        required: true,
        options: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
      },
      {
        label: 'What was the best part of your experience?',
        field_type: 'long_text',
        required: false,
        placeholder: 'Tell us what stood out',
      },
      {
        label: 'What could we do better?',
        field_type: 'long_text',
        required: false,
        placeholder: 'Help us improve',
      },
    ],
  },
  {
    id: 'job-application',
    name: 'Job Application Form',
    description: 'Collect applications from candidates.',
    category: 'HR',
    type: 'form',
    fields: [
      { label: 'First Name', field_type: 'first_name', required: true, placeholder: 'John', mapped_field: 'first_name' },
      { label: 'Last Name', field_type: 'last_name', required: true, placeholder: 'Doe', mapped_field: 'last_name' },
      { label: 'Email Address', field_type: 'email', required: true, placeholder: 'john@example.com', mapped_field: 'email' },
      { label: 'Phone Number', field_type: 'phone', required: true, placeholder: '+1 (555) 000-0000' },
      { label: 'Position Applied For', field_type: 'text', required: true, placeholder: 'e.g. Marketing Manager' },
      { label: 'Years of Experience', field_type: 'number', required: true, placeholder: '5' },
      { label: 'Portfolio / LinkedIn URL', field_type: 'text', required: false, placeholder: 'https://' },
      { label: 'Cover Letter', field_type: 'long_text', required: false, placeholder: 'Tell us why you are a good fit' },
      { label: 'Resume Upload', field_type: 'file_upload', required: true },
      {
        label: 'Consent',
        field_type: 'consent',
        required: true,
        help_text: 'I certify that the information provided is accurate and complete.',
      },
    ],
  },
  {
    id: 'consultation-intake',
    name: 'Consultation Intake',
    description: 'Pre-consultation questionnaire for service businesses.',
    category: 'Client Intake',
    type: 'form',
    fields: [
      { label: 'Full Name', field_type: 'text', required: true, placeholder: 'Jane Smith' },
      { label: 'Email Address', field_type: 'email', required: true, placeholder: 'jane@example.com', mapped_field: 'email' },
      { label: 'Phone Number', field_type: 'phone', required: true, placeholder: '+1 (555) 000-0000' },
      { label: 'Business Name', field_type: 'text', required: false, placeholder: 'Your business' },
      {
        label: 'What type of consultation do you need?',
        field_type: 'dropdown',
        required: true,
        options: ['Strategy Session', 'Technical Review', 'Audit', 'Planning', 'Other'],
      },
      { label: 'Current Challenges', field_type: 'long_text', required: true, placeholder: 'What problems are you facing?' },
      { label: 'Goals', field_type: 'long_text', required: false, placeholder: 'What do you want to achieve?' },
      {
        label: 'Budget Range',
        field_type: 'radio',
        required: false,
        options: ['Under $1k', '$1k - $5k', '$5k - $10k', '$10k+'],
      },
      {
        label: 'Consent',
        field_type: 'consent',
        required: true,
        help_text: 'I agree to be contacted regarding my consultation request.',
      },
    ],
  },
  {
    id: 'webinar-registration',
    name: 'Webinar Registration',
    description: 'Sign up attendees for online webinars.',
    category: 'Events',
    type: 'form',
    fields: [
      { label: 'First Name', field_type: 'first_name', required: true, placeholder: 'John', mapped_field: 'first_name' },
      { label: 'Last Name', field_type: 'last_name', required: true, placeholder: 'Doe', mapped_field: 'last_name' },
      { label: 'Email Address', field_type: 'email', required: true, placeholder: 'john@example.com', mapped_field: 'email' },
      { label: 'Company', field_type: 'text', required: false, placeholder: 'Acme Inc.' },
      { label: 'Job Title', field_type: 'text', required: false, placeholder: 'Marketing Director' },
      {
        label: 'How did you hear about this webinar?',
        field_type: 'dropdown',
        required: false,
        options: ['Email', 'Social Media', 'Colleague', 'Website', 'Other'],
      },
      {
        label: 'Consent',
        field_type: 'consent',
        required: true,
        help_text: 'I agree to receive webinar access details by email.',
      },
    ],
  },
  {
    id: 'course-evaluation',
    name: 'Course Evaluation',
    description: 'Collect student feedback on courses and instructors.',
    category: 'Education',
    type: 'survey',
    fields: [
      { label: 'Student Name', field_type: 'text', required: false, placeholder: 'Optional' },
      { label: 'Course Name', field_type: 'text', required: true, placeholder: 'e.g. Intro to Marketing' },
      { label: 'Instructor Name', field_type: 'text', required: true, placeholder: 'Instructor' },
      {
        label: 'Rate the course content',
        field_type: 'radio',
        required: true,
        options: ['Excellent', 'Good', 'Average', 'Below Average', 'Poor'],
      },
      {
        label: 'Rate the instructor',
        field_type: 'radio',
        required: true,
        options: ['Excellent', 'Good', 'Average', 'Below Average', 'Poor'],
      },
      {
        label: 'Would you recommend this course?',
        field_type: 'radio',
        required: true,
        options: ['Yes', 'Maybe', 'No'],
      },
      { label: 'Additional Comments', field_type: 'long_text', required: false, placeholder: 'Share more thoughts' },
    ],
  },
  {
    id: 'volunteer-signup',
    name: 'Volunteer Sign-Up',
    description: 'Recruit volunteers for events and organizations.',
    category: 'Registration',
    type: 'form',
    fields: [
      { label: 'First Name', field_type: 'first_name', required: true, placeholder: 'John', mapped_field: 'first_name' },
      { label: 'Last Name', field_type: 'last_name', required: true, placeholder: 'Doe', mapped_field: 'last_name' },
      { label: 'Email Address', field_type: 'email', required: true, placeholder: 'john@example.com', mapped_field: 'email' },
      { label: 'Phone Number', field_type: 'phone', required: true, placeholder: '+1 (555) 000-0000' },
      {
        label: 'Available Days',
        field_type: 'multi_select',
        required: true,
        options: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
      },
      {
        label: 'Preferred Role',
        field_type: 'dropdown',
        required: false,
        options: ['Setup', 'Registration', 'Coordination', 'Cleanup', 'Any'],
      },
      { label: 'Skills / Experience', field_type: 'long_text', required: false, placeholder: 'Relevant skills' },
    ],
  },
  {
    id: 'newsletter-signup',
    name: 'Newsletter Sign-Up',
    description: 'Grow your email list with a simple signup form.',
    category: 'Marketing',
    type: 'form',
    fields: [
      { label: 'First Name', field_type: 'first_name', required: true, placeholder: 'John', mapped_field: 'first_name' },
      { label: 'Email Address', field_type: 'email', required: true, placeholder: 'john@example.com', mapped_field: 'email' },
      {
        label: 'Consent',
        field_type: 'consent',
        required: true,
        help_text: 'I agree to receive marketing emails and updates.',
      },
    ],
  },
];
