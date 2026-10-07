import { useRef, useState, type DragEvent } from 'react';
import { CloudUpload, FileJson, X, AlertCircle, LayoutTemplate, CheckCircle2 } from 'lucide-react';
import { checkLayoutFileMeta, parseLayoutFile, LAYOUT_FILE_EXTENSION } from '@/spatial/layoutFile';
import { spaceTypeInfo } from '@/spatial/data/spaceTypes';
import { SIZE_OPTIONS } from '@/spatial/data/sizing';
import { roomTypeLabel } from '@/spatial/data/rooms';
import { cn } from '@/lib/utils';
import { StepTitle } from './ui';
import type { WizardAction, WizardState } from './state';

export function StepImport({ state, dispatch }: { state: WizardState; dispatch: (a: WizardAction) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);

  const load = async (file: File | undefined) => {
    if (!file) return;
    setErrors([]);
    const meta = checkLayoutFileMeta(file);
    if (meta) { setErrors([meta]); return; }
    setReading(true);
    try {
      const result = parseLayoutFile(await file.text());
      if (result.ok) dispatch({ type: 'setImported', layout: result.layout, fileName: file.name });
      else setErrors(result.errors);
    } catch {
      setErrors(["Couldn't read that file. Try saving it again."]);
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    load(e.dataTransfer.files?.[0]);
  };

  const layout = state.importedLayout;
  return (
    <>
      <StepTitle title="Import a layout" subtitle={`Upload a ${LAYOUT_FILE_EXTENSION} file exported from another SYNAPSE workspace.`} />

      {layout ? (
        <div className="rounded-2xl border border-green-200 bg-green-50/60 p-4">
          <div className="flex items-start gap-3">
            <FileJson className="mt-0.5 h-6 w-6 shrink-0 text-green-700" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 font-semibold text-navy-800"><CheckCircle2 className="h-4 w-4 text-green-700" /> Layout ready</p>
              <p className="truncate text-sm text-ivory-700">{state.importFileName}</p>
            </div>
            <button type="button" onClick={() => { dispatch({ type: 'clearImport' }); setErrors([]); }} className="rounded-lg p-1.5 text-ivory-700 hover:bg-white hover:text-navy-800" aria-label="Remove file">
              <X className="h-4 w-4" />
            </button>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-ivory-700">Type</dt><dd className="font-semibold text-navy-800">{spaceTypeInfo(layout.space_type).name}</dd></div>
            <div><dt className="text-ivory-700">Team size</dt><dd className="font-semibold text-navy-800">{SIZE_OPTIONS.find((o) => o.band === layout.size_band)?.people ?? 'Not set'}</dd></div>
            <div><dt className="text-ivory-700">Rooms & zones</dt><dd className="font-semibold text-navy-800">{layout.config.rooms.length}</dd></div>
          </dl>
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {layout.config.rooms.slice(0, 12).map((r) => (
              <li key={r.id} className="rounded-lg bg-white px-2 py-1 text-xs text-navy-700 ring-1 ring-navy-50">{r.name} · {roomTypeLabel(r.type)}</li>
            ))}
            {layout.config.rooms.length > 12 && <li className="px-1 py-1 text-xs text-ivory-700">+{layout.config.rooms.length - 12} more</li>}
          </ul>
          <p className="mt-3 text-xs text-ivory-700">You can rename, add or remove rooms on the next step.</p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex w-full flex-col items-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition',
            dragging ? 'border-gold-400 bg-gold-50' : 'border-navy-100 hover:border-gold-400 hover:bg-gold-50/40',
          )}
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-navy-800 text-gold-400"><CloudUpload className="h-7 w-7" /></span>
          <span className="mt-4 font-semibold text-navy-800">{reading ? 'Reading…' : 'Choose a layout file or drop it here'}</span>
          <span className="mt-1 text-sm text-ivory-700">{LAYOUT_FILE_EXTENSION} · up to 2 MB</span>
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        aria-label="Layout file"
        onChange={(e) => load(e.target.files?.[0])}
      />

      {errors.length > 0 && (
        <div role="alert" className="mt-4 rounded-2xl border border-burgundy-400/30 bg-red-50 p-4">
          <p className="flex items-center gap-2 font-semibold text-burgundy-600"><AlertCircle className="h-4 w-4" /> We couldn't use that file</p>
          <ul className="mt-2 max-h-48 list-disc space-y-1 overflow-y-auto pl-6 text-sm text-burgundy-600">
            {errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        </div>
      )}

      <div className="mt-6 flex items-center gap-3 rounded-2xl border border-navy-100 bg-ivory-200/20 p-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-ivory-600 ring-1 ring-navy-50"><LayoutTemplate className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ivory-800">Template gallery</p>
          <p className="text-sm text-ivory-700">Ready-made layouts shared by the SYNAPSE community.</p>
        </div>
        <span className="shrink-0 rounded-md bg-ivory-200 px-2.5 py-1 text-xs font-semibold text-ivory-800">Coming soon</span>
      </div>
      <p className="mt-4 text-sm text-ivory-700">Tip: open a workspace's menu on the Workspaces page and choose <strong>Export layout</strong> to get a file.</p>
    </>
  );
}
