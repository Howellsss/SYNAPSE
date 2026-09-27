import { useRef, useState } from 'react';
import { User, Pencil, Trash2, Plus, Mail, MessageSquare, Smartphone, PhoneIncoming, ChevronDown, Info } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { supabase } from '@/lib/supabase';
import { Modal } from '@/components/ui/Modal';
import { TimezoneSelect } from '@/components/ui/TimezoneSelect';
import { cn } from '@/lib/utils';
import type { DndChannel, PhoneType } from '@/types';

const COUNTRIES = [
  { code: 'NG', flag: '🇳🇬', dial: '+234', name: 'Nigeria' },
  { code: 'GH', flag: '🇬🇭', dial: '+233', name: 'Ghana' },
  { code: 'US', flag: '🇺🇸', dial: '+1', name: 'United States / Canada' },
  { code: 'GB', flag: '🇬🇧', dial: '+44', name: 'United Kingdom' },
  { code: 'ZA', flag: '🇿🇦', dial: '+27', name: 'South Africa' },
  { code: 'KE', flag: '🇰🇪', dial: '+254', name: 'Kenya' },
  { code: 'AE', flag: '🇦🇪', dial: '+971', name: 'United Arab Emirates' },
  { code: 'IN', flag: '🇮🇳', dial: '+91', name: 'India' },
];

const PHONE_TYPES: { value: PhoneType; label: string }[] = [
  { value: 'mobile', label: 'Mobile' },
  { value: 'home', label: 'Home' },
  { value: 'work', label: 'Work' },
  { value: 'other', label: 'Other' },
];

const DND_CHANNELS: { value: DndChannel; label: string; icon: typeof Mail; hint?: string }[] = [
  { value: 'email', label: 'Email', icon: Mail },
  { value: 'sms', label: 'Text messages', icon: MessageSquare },
  { value: 'calls', label: 'Calls & voicemail', icon: Smartphone },
  { value: 'inbound', label: 'Inbound calls and SMS', icon: PhoneIncoming, hint: 'Also block calls and texts this contact sends to you.' },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

interface PhoneRow { type: PhoneType | ''; country: string; number: string }

const emptyForm = () => ({
  first_name: '',
  last_name: '',
  emails: [''],
  primaryEmail: 0,
  phones: [{ type: '', country: 'NG', number: '' }] as PhoneRow[],
  primaryPhone: 0,
  company: '',
  job_title: '',
  contact_type: '' as '' | 'lead' | 'customer',
  timezone: '',
  dnd_all: false,
  dnd_channels: [] as DndChannel[],
});

function formatPhone(row: PhoneRow): string {
  const raw = row.number.trim();
  if (!raw) return '';
  if (raw.startsWith('+')) return raw.replace(/\s+/g, ' ');
  const dial = COUNTRIES.find((c) => c.code === row.country)?.dial ?? '';
  const digits = raw.replace(/\D/g, '').replace(/^0+/, '');
  return dial ? `${dial} ${digits}` : digits;
}

function isMissingColumnError(error: { code?: string; message?: string }) {
  return error.code === 'PGRST204' || /column .* does not exist|schema cache/i.test(error.message ?? '');
}

export function AddContactModal({ onClose, onAdded }: { onClose: () => void; onAdded: (keepOpen: boolean) => void }) {
  const { workspace, user } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState(emptyForm);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const firstNameRef = useRef<HTMLInputElement>(null);

  const update = (patch: Partial<ReturnType<typeof emptyForm>>) => setForm((f) => ({ ...f, ...patch }));

  const firstNameError = submitted && !form.first_name.trim() ? 'This field is required' : null;
  const emailErrors = form.emails.map((e) => (submitted && e.trim() && !EMAIL_RE.test(e.trim()) ? 'Enter a valid email address' : null));

  const pickImage = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Please choose an image file.', 'error'); return; }
    if (file.size > MAX_IMAGE_BYTES) { toast('Image must be 5 MB or smaller.', 'error'); return; }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const setEmail = (i: number, value: string) => update({ emails: form.emails.map((e, j) => (j === i ? value : e)) });
  const removeEmail = (i: number) => {
    if (form.emails.length === 1) { update({ emails: [''] }); return; }
    const emails = form.emails.filter((_, j) => j !== i);
    update({ emails, primaryEmail: i === form.primaryEmail ? 0 : form.primaryEmail > i ? form.primaryEmail - 1 : form.primaryEmail });
  };

  const setPhone = (i: number, patch: Partial<PhoneRow>) => update({ phones: form.phones.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const removePhone = (i: number) => {
    if (form.phones.length === 1) { update({ phones: [{ type: '', country: form.phones[0].country, number: '' }] }); return; }
    const phones = form.phones.filter((_, j) => j !== i);
    update({ phones, primaryPhone: i === form.primaryPhone ? 0 : form.primaryPhone > i ? form.primaryPhone - 1 : form.primaryPhone });
  };

  const toggleDndAll = (checked: boolean) => update({ dnd_all: checked, dnd_channels: checked ? DND_CHANNELS.map((c) => c.value) : [] });
  const toggleChannel = (channel: DndChannel, checked: boolean) => {
    const dnd_channels = checked ? [...form.dnd_channels, channel] : form.dnd_channels.filter((c) => c !== channel);
    update({ dnd_channels, dnd_all: dnd_channels.length === DND_CHANNELS.length });
  };

  const reset = () => {
    setForm(emptyForm());
    setImageFile(null);
    setImagePreview(null);
    setSubmitted(false);
    firstNameRef.current?.focus();
  };

  const save = async (keepOpen: boolean) => {
    setSubmitted(true);
    if (!form.first_name.trim()) { firstNameRef.current?.focus(); return; }
    if (emailErrors.some(Boolean) || form.emails.some((e) => e.trim() && !EMAIL_RE.test(e.trim()))) return;
    if (!workspace) { toast('No workspace found. Please refresh and try again.', 'error'); return; }

    setSaving(true);

    let avatar_url: string | null = null;
    if (imageFile) {
      const ext = imageFile.name.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `contacts/${workspace.id}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from('avatars').upload(path, imageFile, { contentType: imageFile.type });
      if (uploadError) {
        toast(`Couldn't upload the image: ${uploadError.message}`, 'error');
        setSaving(false);
        return;
      }
      avatar_url = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
    }

    const emails = form.emails.map((e) => e.trim());
    const primaryEmail = emails[form.primaryEmail] || emails.find(Boolean) || null;
    const additional_emails = emails.filter((e) => e && e !== primaryEmail);

    const phones = form.phones.map((p) => ({ type: (p.type || 'mobile') as PhoneType, number: formatPhone(p) }));
    const primary = phones[form.primaryPhone]?.number ? phones[form.primaryPhone] : phones.find((p) => p.number);
    const additional_phones = phones.filter((p) => p.number && p !== primary);

    const dndEmail = form.dnd_all || form.dnd_channels.includes('email');
    const dndSms = form.dnd_all || form.dnd_channels.includes('sms');

    const core = {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim() || null,
      email: primaryEmail,
      phone: primary?.number || null,
      company: form.company.trim() || null,
      job_title: form.job_title.trim() || null,
      avatar_url,
      email_opt_in: !dndEmail,
      sms_opt_in: !dndSms,
      workspace_id: workspace.id,
      owner_id: user?.id ?? null,
      source: 'manual',
    };
    const details = {
      additional_emails,
      phone_type: primary ? primary.type : null,
      additional_phones,
      contact_type: form.contact_type || null,
      timezone: form.timezone || null,
      dnd_all: form.dnd_all,
      dnd_channels: form.dnd_channels,
    };

    let { error } = await supabase.from('contacts').insert({ ...core, ...details });
    let savedWithoutDetails = false;
    if (error && isMissingColumnError(error)) {
      // The database hasn't had the contact-details migration yet: keep the contact rather than losing it.
      ({ error } = await supabase.from('contacts').insert(core));
      savedWithoutDetails = !error;
    }
    setSaving(false);

    if (error) {
      toast(error.message, 'error');
      return;
    }
    toast(
      savedWithoutDetails
        ? 'Contact added. Extra emails, phones, contact type, time zone and DND need the latest database update to be saved.'
        : 'Contact added',
      savedWithoutDetails ? 'info' : 'success',
    );
    if (keepOpen) reset();
    onAdded(keepOpen);
  };

  const label = 'block text-sm font-medium text-navy-700 mb-1.5';
  const addLink = 'inline-flex items-center gap-1 text-sm font-medium text-gold-700 hover:text-gold-600 transition-colors mt-2';

  return (
    <Modal
      open
      onClose={onClose}
      title="Add Contact"
      footer={
        <>
          <button type="button" onClick={() => save(true)} disabled={saving} className="btn-ghost mr-auto -ml-3">
            Save and add another
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="button" onClick={() => save(false)} disabled={saving} className="btn-primary min-w-[88px]">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); save(false); }} className="space-y-5" noValidate>
        {/* Contact image */}
        <div>
          <p className={label}>Contact image</p>
          <div className="relative h-20 w-20">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              aria-label={imagePreview ? 'Change contact image' : 'Upload contact image'}
              className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-ivory-100 text-navy-400 ring-1 ring-navy-100 transition hover:ring-gold-400"
            >
              {imagePreview ? <img src={imagePreview} alt="" className="h-full w-full object-cover" /> : <User className="h-9 w-9" />}
            </button>
            <span className="pointer-events-none absolute -bottom-0.5 -right-0.5 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-navy-800 text-gold-400">
              <Pencil className="h-3.5 w-3.5" />
            </span>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { pickImage(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
        </div>

        {/* Names */}
        <div>
          <label htmlFor="ac-first" className={label}>First name <span className="text-burgundy-600">*</span></label>
          <input
            id="ac-first"
            ref={firstNameRef}
            autoFocus
            className={cn('input-field', firstNameError && 'border-burgundy-500 focus:border-burgundy-500 focus:ring-burgundy-500/20')}
            placeholder="Enter first name"
            value={form.first_name}
            onChange={(e) => update({ first_name: e.target.value })}
            aria-invalid={!!firstNameError}
            aria-describedby={firstNameError ? 'ac-first-error' : undefined}
          />
          {firstNameError && <p id="ac-first-error" className="mt-1.5 text-sm text-burgundy-600">{firstNameError}</p>}
        </div>
        <div>
          <label htmlFor="ac-last" className={label}>Last name</label>
          <input id="ac-last" className="input-field" placeholder="Enter last name" value={form.last_name} onChange={(e) => update({ last_name: e.target.value })} />
        </div>

        {/* Emails */}
        <fieldset className="min-w-0">
          <legend className={label}>Email</legend>
          <div className="space-y-2">
            {form.emails.map((email, i) => (
              <div key={i}>
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="primary-email"
                    checked={form.primaryEmail === i}
                    onChange={() => update({ primaryEmail: i })}
                    aria-label={`Make email ${i + 1} primary`}
                    title="Primary email"
                    className="h-4 w-4 shrink-0 accent-navy-800"
                  />
                  <input
                    type="email"
                    className={cn('input-field', emailErrors[i] && 'border-burgundy-500')}
                    placeholder="Enter email address"
                    value={email}
                    onChange={(e) => setEmail(i, e.target.value)}
                    aria-label={`Email ${i + 1}`}
                  />
                  <button type="button" onClick={() => removeEmail(i)} aria-label={`Remove email ${i + 1}`} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-navy-100 text-ivory-600 transition hover:border-burgundy-400 hover:text-burgundy-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                {emailErrors[i] && <p className="ml-6 mt-1 text-sm text-burgundy-600">{emailErrors[i]}</p>}
              </div>
            ))}
          </div>
          <button type="button" onClick={() => update({ emails: [...form.emails, ''] })} className={addLink}>
            <Plus className="h-3.5 w-3.5" /> Add email
          </button>
        </fieldset>

        {/* Phones */}
        <fieldset className="min-w-0">
          <legend className={label}>Phone</legend>
          <div className="space-y-2">
            {form.phones.map((phone, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                <input
                  type="radio"
                  name="primary-phone"
                  checked={form.primaryPhone === i}
                  onChange={() => update({ primaryPhone: i })}
                  aria-label={`Make phone ${i + 1} primary`}
                  title="Primary phone"
                  className="h-4 w-4 shrink-0 accent-navy-800"
                />
                <div className="relative min-w-0 flex-1 sm:w-28 sm:flex-none">
                  <select
                    className={cn('input-field appearance-none pr-8', !phone.type && 'text-ivory-600')}
                    value={phone.type}
                    onChange={(e) => setPhone(i, { type: e.target.value as PhoneType })}
                    aria-label={`Phone ${i + 1} type`}
                  >
                    <option value="" disabled>Select</option>
                    {PHONE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ivory-600" />
                </div>
                <div className="order-last ml-6 flex min-w-0 basis-[calc(100%-1.5rem)] items-center rounded-xl border border-navy-100 bg-white sm:order-none sm:ml-0 sm:flex-1 sm:basis-auto transition focus-within:border-gold-400 focus-within:ring-2 focus-within:ring-gold-400/20">
                  {/* Compact trigger (flag + code); the native list still shows full country names. */}
                  <div className="relative flex h-10 shrink-0 items-center gap-1 border-r border-navy-100 pl-3 pr-2 text-sm text-navy-700">
                    <span className="text-base leading-none">{COUNTRIES.find((c) => c.code === phone.country)?.flag}</span>
                    <span className="tabular-nums">{COUNTRIES.find((c) => c.code === phone.country)?.dial}</span>
                    <ChevronDown className="h-3.5 w-3.5 text-ivory-600" />
                    <select
                      className="absolute inset-0 cursor-pointer opacity-0"
                      value={phone.country}
                      onChange={(e) => setPhone(i, { country: e.target.value })}
                      aria-label={`Phone ${i + 1} country`}
                      title={COUNTRIES.find((c) => c.code === phone.country)?.name}
                    >
                      {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.flag} {c.dial} {c.name}</option>)}
                    </select>
                  </div>
                  <input
                    type="tel"
                    className="h-10 min-w-0 flex-1 bg-transparent px-2 text-sm text-navy-700 outline-none placeholder:text-ivory-600"
                    placeholder="Enter phone number"
                    value={phone.number}
                    onChange={(e) => setPhone(i, { number: e.target.value })}
                    aria-label={`Phone ${i + 1} number`}
                  />
                </div>
                <button type="button" onClick={() => removePhone(i)} aria-label={`Remove phone ${i + 1}`} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-navy-100 text-ivory-600 transition hover:border-burgundy-400 hover:text-burgundy-600">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => update({ phones: [...form.phones, { type: '', country: form.phones[form.phones.length - 1]?.country ?? 'NG', number: '' }] })} className={addLink}>
            <Plus className="h-3.5 w-3.5" /> Add phone
          </button>
        </fieldset>

        {/* Company + job title (SYNAPSE fields) */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="ac-company" className={label}>Company</label>
            <input id="ac-company" className="input-field" placeholder="Enter company" value={form.company} onChange={(e) => update({ company: e.target.value })} />
          </div>
          <div>
            <label htmlFor="ac-job" className={label}>Job title</label>
            <input id="ac-job" className="input-field" placeholder="Enter job title" value={form.job_title} onChange={(e) => update({ job_title: e.target.value })} />
          </div>
        </div>

        {/* Contact type */}
        <div>
          <label htmlFor="ac-type" className={label}>Contact type</label>
          <div className="relative">
            <select
              id="ac-type"
              className={cn('input-field appearance-none pr-9', !form.contact_type && 'text-ivory-600')}
              value={form.contact_type}
              onChange={(e) => update({ contact_type: e.target.value as 'lead' | 'customer' })}
            >
              <option value="" disabled>Select contact type</option>
              <option value="lead">Lead</option>
              <option value="customer">Customer</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ivory-600" />
          </div>
        </div>

        {/* Time zone */}
        <div>
          <p className={label}>Time zone</p>
          <TimezoneSelect value={form.timezone} onChange={(tz) => update({ timezone: tz })} />
        </div>

        {/* Do not disturb */}
        <fieldset className="min-w-0 rounded-2xl border border-navy-100 p-5">
          <legend className="sr-only">Do not disturb</legend>
          <label className="flex items-center gap-3 text-sm font-medium text-navy-700">
            <input type="checkbox" checked={form.dnd_all} onChange={(e) => toggleDndAll(e.target.checked)} className="h-4 w-4 rounded accent-navy-800" />
            DND all channels
          </label>
          <div className="my-4 flex items-center gap-3 text-xs font-medium text-ivory-600">
            <span className="h-px flex-1 bg-navy-100" /> OR <span className="h-px flex-1 bg-navy-100" />
          </div>
          <p className="mb-2 text-sm font-medium text-navy-700">Channels</p>
          <div className="space-y-2.5">
            {DND_CHANNELS.map(({ value, label: text, icon: Icon, hint }) => (
              <label key={value} className="flex items-center gap-3 text-sm text-navy-700">
                <input type="checkbox" checked={form.dnd_channels.includes(value)} onChange={(e) => toggleChannel(value, e.target.checked)} className="h-4 w-4 rounded accent-navy-800" />
                <Icon className="h-4 w-4 text-ivory-600" />
                {text}
                {hint && (
                  <span title={hint} className="text-ivory-600">
                    <Info className="h-3.5 w-3.5" aria-label={hint} />
                  </span>
                )}
              </label>
            ))}
          </div>
        </fieldset>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
