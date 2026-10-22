import { supabase } from '@/lib/supabase';

/**
 * Pictures and files for forms, kept in the public `form-files` bucket
 * (migration 20261022090000_form_files.sql):
 * - assets/<workspace>/…  images, logos and backgrounds added in the builder;
 * - responses/<form>/…    files and signatures people send with a form.
 */
export const FORM_FILES_BUCKET = 'form-files';
export const MAX_FORM_FILE_MB = 10;

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif'];

/** "Report.PDF" -> "pdf". */
export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** A readable size: 2.4 MB, 820 KB. */
export function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Whether a file may be sent in a File Upload field: its type is one the field allows
 * (`pdf`, `.jpg`, `image/*` all work) and it isn't too big. Returns the problem, or null.
 */
export function fileProblem(file: { name: string; size: number; type: string }, allowed: string[] | undefined, maxMB: number | undefined): string | null {
  const limit = Math.min(maxMB && maxMB > 0 ? maxMB : MAX_FORM_FILE_MB, MAX_FORM_FILE_MB);
  if (file.size > limit * 1024 * 1024) return `That file is ${fileSize(file.size)}. The limit is ${limit} MB.`;
  const list = (allowed ?? []).map((a) => a.trim().toLowerCase().replace(/^\./, '')).filter(Boolean);
  if (!list.length) return null;
  const ext = extensionOf(file.name);
  const mime = (file.type || '').toLowerCase();
  const ok = list.some((a) => a === ext || (a === 'jpg' && ext === 'jpeg') || (a === 'jpeg' && ext === 'jpg')
    || a === mime || (a.endsWith('/*') && mime.startsWith(a.slice(0, -1))));
  return ok ? null : `Please choose a ${list.map((a) => a.toUpperCase()).join(', ')} file.`;
}

/** What a File Upload field's file picker should offer (the `accept` attribute). */
export function acceptAttr(allowed: string[] | undefined): string | undefined {
  const list = (allowed ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return undefined;
  return list.map((a) => (a.includes('/') || a.startsWith('.') ? a : `.${a}`)).join(',');
}

const randomName = () => `${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(2)).join('')}`;
const safeExt = (name: string, fallback: string) => (extensionOf(name).replace(/[^a-z0-9]/g, '').slice(0, 8) || fallback);

async function put(path: string, body: Blob, contentType: string): Promise<string> {
  const { error } = await supabase.storage.from(FORM_FILES_BUCKET).upload(path, body, { contentType, upsert: false, cacheControl: '31536000' });
  if (error) {
    if (/bucket not found/i.test(error.message)) throw new Error('Uploads need the database update 20261022090000_form_files.sql.');
    if (/row-level security|unauthorized|not allowed/i.test(error.message)) throw new Error('This form isn’t taking files right now.');
    if (/exceeded|too large|payload/i.test(error.message)) throw new Error(`Files can be up to ${MAX_FORM_FILE_MB} MB.`);
    throw new Error(error.message);
  }
  return supabase.storage.from(FORM_FILES_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** An image for the builder (an Image or Logo element, a background). Returns its link. */
export async function uploadFormImage(workspaceId: string, file: File): Promise<string> {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error('Choose a picture: PNG, JPG, GIF, WebP or SVG.');
  if (file.size > MAX_FORM_FILE_MB * 1024 * 1024) throw new Error(`Pictures can be up to ${MAX_FORM_FILE_MB} MB.`);
  return put(`assets/${workspaceId}/${randomName()}.${safeExt(file.name, 'png')}`, file, file.type);
}

/** A file someone sends with a form (File Upload, or their drawn signature). Returns its link. */
export async function uploadFormResponseFile(formId: string, file: Blob, name: string): Promise<string> {
  return put(`responses/${formId}/${randomName()}/${name.replace(/[^\w.-]+/g, '_').slice(-80) || 'file'}`, file, file.type || 'application/octet-stream');
}

/** A signature drawn on a canvas: a PNG data URL, as a file. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, data] = dataUrl.split(',');
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'image/png';
  const bytes = atob(data);
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes.charCodeAt(i);
  return new Blob([out], { type: mime });
}
