import type {
  FormField,
  ConditionOperator,
  FormFieldType,
  Calendar,
} from '@/types';
import { publicOrigin } from '@/lib/publicUrl';

// ============================================================
// DEFAULT BOOKING FORM
// ============================================================

export const DEFAULT_BOOKING_FIELDS: Omit<FormField, 'id' | 'form_id'>[] = [
  {
    label: 'First Name',
    field_type: 'first_name',
    required: true,
    placeholder: 'John',
    help_text: null,
    default_value: null,
    options: null,
    validation: null,
    sort_order: 0,
    mapped_field: 'first_name',
  },
  {
    label: 'Last Name',
    field_type: 'last_name',
    required: true,
    placeholder: 'Doe',
    help_text: null,
    default_value: null,
    options: null,
    validation: null,
    sort_order: 1,
    mapped_field: 'last_name',
  },
  {
    label: 'Phone Number',
    field_type: 'phone',
    required: false,
    placeholder: '+1 (555) 000-0000',
    help_text: null,
    default_value: null,
    options: null,
    validation: null,
    sort_order: 2,
    mapped_field: 'phone',
  },
  {
    label: 'Email Address',
    field_type: 'email',
    required: true,
    placeholder: 'john@example.com',
    help_text: null,
    default_value: null,
    options: null,
    validation: null,
    sort_order: 3,
    mapped_field: 'email',
  },
  {
    label: 'Additional Information',
    field_type: 'long_text',
    required: false,
    placeholder: 'Share any details that would help prepare for the meeting',
    help_text: null,
    default_value: null,
    options: null,
    validation: null,
    sort_order: 4,
    mapped_field: null,
  },
];

// ============================================================
// FIELD TYPE METADATA
// ============================================================

export const FIELD_TYPE_METADATA: Record<
  FormFieldType,
  { label: string; supportsOptions: boolean; supportsValidation: boolean }
> = {
  first_name: { label: 'First Name', supportsOptions: false, supportsValidation: false },
  last_name: { label: 'Last Name', supportsOptions: false, supportsValidation: false },
  text: { label: 'Single Line Text', supportsOptions: false, supportsValidation: true },
  long_text: { label: 'Long Text', supportsOptions: false, supportsValidation: true },
  phone: { label: 'Phone', supportsOptions: false, supportsValidation: true },
  email: { label: 'Email', supportsOptions: false, supportsValidation: true },
  number: { label: 'Number', supportsOptions: false, supportsValidation: true },
  radio: { label: 'Radio', supportsOptions: true, supportsValidation: false },
  checkbox: { label: 'Checkbox', supportsOptions: true, supportsValidation: false },
  multi_select: { label: 'Multi-select', supportsOptions: true, supportsValidation: false },
  dropdown: { label: 'Dropdown', supportsOptions: true, supportsValidation: false },
  date: { label: 'Date', supportsOptions: false, supportsValidation: true },
  time: { label: 'Time', supportsOptions: false, supportsValidation: true },
  file_upload: { label: 'File Upload', supportsOptions: false, supportsValidation: false },
  consent: { label: 'Consent', supportsOptions: false, supportsValidation: false },
  hidden: { label: 'Hidden Field', supportsOptions: false, supportsValidation: false },
};

export const ALL_FIELD_TYPES: FormFieldType[] = [
  'first_name', 'last_name', 'text', 'long_text', 'phone', 'email', 'number',
  'radio', 'checkbox', 'multi_select', 'dropdown', 'date', 'time',
  'file_upload', 'consent', 'hidden',
];

// ============================================================
// FORM RESOLUTION
// ============================================================

export interface ResolvedForm {
  fields: FormField[];
  isDefault: boolean;
  formId: string | null;
}

/**
 * Resolve which form fields to show for a calendar.
 * If form_mode is 'default' or no custom form is connected,
 * returns the default booking fields.
 */
export function resolveBookingForm(calendar: Calendar, customFields: FormField[]): ResolvedForm {
  if (calendar.form_mode === 'custom' && calendar.connected_form_id && customFields.length > 0) {
    return {
      fields: customFields,
      isDefault: false,
      formId: calendar.connected_form_id,
    };
  }

  return {
    fields: DEFAULT_BOOKING_FIELDS.map((f, i) => ({
      ...f,
      id: `default-${i}`,
      form_id: 'default',
      sort_order: i,
    })) as FormField[],
    isDefault: true,
    formId: null,
  };
}

// ============================================================
// FORM VALIDATION
// ============================================================

export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

export function validateForm(
  fields: FormField[],
  data: Record<string, string>,
): ValidationResult {
  const errors: Record<string, string> = {};

  for (const field of fields) {
    if (field.field_type === 'hidden') continue;

    const value = data[field.label] ?? data[field.mapped_field ?? ''] ?? '';
    const isRequired = field.required;

    if (isRequired && !value.trim()) {
      errors[field.label] = `${field.label} is required`;
      continue;
    }

    if (!value.trim()) continue;

    if (field.field_type === 'email') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) {
        errors[field.label] = 'Please enter a valid email address';
      }
    }

    if (field.field_type === 'phone') {
      const phoneRegex = /^[+]?[\d\s()\-.]{7,}$/;
      if (!phoneRegex.test(value)) {
        errors[field.label] = 'Please enter a valid phone number';
      }
    }

    if (field.field_type === 'number') {
      if (isNaN(Number(value))) {
        errors[field.label] = 'Please enter a valid number';
      }
    }

    if (field.validation) {
      const v = field.validation as Record<string, unknown>;
      if (v.min_length && value.length < Number(v.min_length)) {
        errors[field.label] = `Must be at least ${v.min_length} characters`;
      }
      if (v.max_length && value.length > Number(v.max_length)) {
        errors[field.label] = `Must be no more than ${v.max_length} characters`;
      }
      if (v.pattern) {
        try {
          const regex = new RegExp(String(v.pattern));
          if (!regex.test(value)) {
            errors[field.label] = (v.pattern_message as string) ?? 'Invalid format';
          }
        } catch {
          // invalid regex, skip
        }
      }
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

// ============================================================
// CONDITIONAL LOGIC ENGINE
// ============================================================

export interface ConditionEvaluationResult {
  visibleFields: Set<string>;
  requiredFields: Set<string>;
  disqualified: boolean;
  disqualifyMessage: string | null;
  redirectUrl: string | null;
  displayMessages: { fieldId: string; message: string }[];
}

/**
 * Evaluate conditional logic for form fields.
 * Returns which fields should be visible, required, and any
 * disqualifications or messages to display.
 */
export function evaluateConditions(
  fields: FormField[],
  data: Record<string, string>,
): ConditionEvaluationResult {
  const visibleFields = new Set(fields.map(f => f.id));
  const requiredFields = new Set(fields.filter(f => f.required).map(f => f.id));
  let disqualified = false;
  let disqualifyMessage: string | null = null;
  let redirectUrl: string | null = null;
  const displayMessages: { fieldId: string; message: string }[] = [];

  for (const field of fields) {
    if (!field.conditions) continue;

    for (const condition of field.conditions) {
      const triggerValue = data[getFieldValueKey(condition.trigger_field_id, fields)] ?? '';
      const matches = evaluateOperator(
        condition.trigger_operator,
        triggerValue,
        condition.trigger_value ?? '',
      );

      if (!matches) continue;

      switch (condition.condition_type) {
        case 'show':
          if (!visibleFields.has(field.id)) {
            // field was hidden, now show it
          }
          visibleFields.add(field.id);
          break;

        case 'hide':
          visibleFields.delete(field.id);
          break;

        case 'require':
          requiredFields.add(field.id);
          break;

        case 'disqualify':
          disqualified = true;
          disqualifyMessage = condition.action_config.message ?? 'You do not meet the requirements for this booking.';
          break;

        case 'display_message':
          displayMessages.push({
            fieldId: field.id,
            message: condition.action_config.message ?? '',
          });
          break;

        case 'redirect':
          redirectUrl = condition.action_config.redirect_url ?? null;
          break;
      }
    }
  }

  return {
    visibleFields,
    requiredFields,
    disqualified,
    disqualifyMessage,
    redirectUrl,
    displayMessages,
  };
}

function getFieldValueKey(fieldId: string, fields: FormField[]): string {
  const field = fields.find(f => f.id === fieldId);
  return field?.label ?? field?.mapped_field ?? fieldId;
}

function evaluateOperator(
  operator: ConditionOperator,
  actual: string,
  expected: string,
): boolean {
  switch (operator) {
    case 'equals':
      return actual.trim().toLowerCase() === expected.trim().toLowerCase();
    case 'not_equals':
      return actual.trim().toLowerCase() !== expected.trim().toLowerCase();
    case 'contains':
      return actual.toLowerCase().includes(expected.toLowerCase());
    case 'not_contains':
      return !actual.toLowerCase().includes(expected.toLowerCase());
    case 'is_empty':
      return !actual.trim();
    case 'is_not_empty':
      return !!actual.trim();
    case 'greater_than':
      return Number(actual) > Number(expected);
    case 'less_than':
      return Number(actual) < Number(expected);
    default:
      return false;
  }
}

// ============================================================
// FORM DATA EXTRACTION
// ============================================================

export function extractContactInfo(
  fields: FormField[],
  data: Record<string, string>,
): {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  company: string;
} {
  const findValue = (type: FormFieldType) => {
    const field = fields.find(f => f.field_type === type);
    if (!field) return '';
    return data[field.label] ?? data[field.mapped_field ?? ''] ?? '';
  };

  return {
    first_name: findValue('first_name'),
    last_name: findValue('last_name'),
    email: findValue('email'),
    phone: findValue('phone'),
    company: '',
  };
}

// ============================================================
// EMBED CODE GENERATION
// ============================================================

export function generateEmbedCode(
  calendarSlug: string,
  config: { type: 'inline' | 'popup' | 'button'; buttonText?: string; width?: string; height?: string },
): string {
  const baseUrl = publicOrigin();
  const bookingUrl = `${baseUrl}/book/${calendarSlug}`;

  if (config.type === 'inline') {
    return `<iframe
  src="${bookingUrl}?embed=inline"
  style="width: ${config.width ?? '100%'}; height: ${config.height ?? '600px'}; border: 0; border-radius: 12px;"
  title="Book with us"
></iframe>`;
  }

  if (config.type === 'popup') {
    return `<script>
(function() {
  var btn = document.createElement('button');
  btn.innerText = '${config.buttonText ?? 'Book Now'}';
  btn.style.cssText = 'padding:12px 28px;border-radius:10px;border:none;cursor:pointer;font-size:15px;font-weight:600;color:#fff;background:#0a1628;';
  btn.onclick = function() {
    var o = document.createElement('div');
    o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
    o.onclick = function(e){ if(e.target===o){ document.body.removeChild(o); } };
    var f = document.createElement('iframe');
    f.src = '${bookingUrl}?embed=popup';
    f.style.cssText = 'width:100%;max-width:900px;height:85vh;border:0;border-radius:16px;background:#fff;';
    f.title = 'Book with us';
    o.appendChild(f);
    document.body.appendChild(o);
  };
  document.currentScript.parentNode.insertBefore(btn, document.currentScript.nextSibling);
})();
</script>`;
  }

  // button
  return `<script>
(function() {
  var btn = document.createElement('button');
  btn.innerText = '${config.buttonText ?? 'Book Now'}';
  btn.style.cssText = 'padding:12px 28px;border-radius:10px;border:none;cursor:pointer;font-size:15px;font-weight:600;color:#fff;background:#0a1628;';
  btn.onclick = function() {
    var w = window.open('${bookingUrl}?embed=popup', '_blank', 'width=900,height=700,scrollbars=yes');
    if (w) w.focus();
  };
  document.currentScript.parentNode.insertBefore(btn, document.currentScript.nextSibling);
})();
</script>`;
}
