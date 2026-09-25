import { useEffect, useState, useMemo } from 'react';
import {
  Plus, LayoutTemplate, Sparkles, Search, ChevronRight, ChevronLeft,
  FileText, BarChart3, Eye, Check, X, Loader2, Wand2, ArrowRight,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import {
  FORM_TEMPLATES, TEMPLATE_CATEGORIES, DEFAULT_CONTACT_FIELDS,
  type FormTemplate, type TemplateCategory, type TemplateField,
} from '@/lib/form-templates';
import { FIELD_TYPE_METADATA } from '@/lib/booking-form';
import type { FormFieldType } from '@/types';

type CreationPath = 'choose' | 'scratch' | 'templates' | 'ai' | 'template-preview';
type FormType = 'form' | 'survey';

const AI_SUGGESTIONS_FORM = [
  'Create a client onboarding form for a digital marketing agency',
  'Create a job application form',
  'Build a consultation intake form',
  'Build an event registration form',
  'Create a product order form for a small business',
  'Create a service request form for a cleaning company',
];

const AI_SUGGESTIONS_SURVEY = [
  'Create a customer satisfaction survey for a consulting company',
  'Build a post-event feedback survey',
  'Create an employee engagement survey',
  'Build a product feedback survey for a SaaS app',
  'Create a course evaluation survey',
  'Build a market research survey for a new product launch',
];

interface CreateFormFlowProps {
  open: boolean;
  onClose: () => void;
  isSurvey: boolean;
  onCreated: (formId: string) => void;
}

export function CreateFormFlow({ open, onClose, isSurvey, onCreated }: CreateFormFlowProps) {
  const [path, setPath] = useState<CreationPath>('choose');
  const [selectedTemplate, setSelectedTemplate] = useState<FormTemplate | null>(null);

  useEffect(() => {
    if (open) {
      setPath('choose');
      setSelectedTemplate(null);
    }
  }, [open]);

  const handleBack = () => {
    if (path === 'template-preview') setPath('templates');
    else setPath('choose');
  };

  const handleCreated = (formId: string) => {
    onCreated(formId);
  };

  const title = isSurvey ? 'Create Survey' : 'Create Form';
  const typeLabel = isSurvey ? 'survey' : 'form';

  return (
    <Modal open={open} onClose={onClose} title={title} size={path === 'choose' ? 'md' : 'xl'}>
      {path === 'choose' && (
        <PathChooser
          isSurvey={isSurvey}
          onScratch={() => setPath('scratch')}
          onTemplates={() => setPath('templates')}
          onAI={() => setPath('ai')}
        />
      )}

      {path === 'scratch' && (
        <ScratchForm
          isSurvey={isSurvey}
          onBack={handleBack}
          onCreated={handleCreated}
        />
      )}

      {path === 'templates' && (
        <TemplateGallery
          isSurvey={isSurvey}
          onBack={handleBack}
          onSelect={(tpl) => { setSelectedTemplate(tpl); setPath('template-preview'); }}
        />
      )}

      {path === 'template-preview' && selectedTemplate && (
        <TemplatePreview
          template={selectedTemplate}
          isSurvey={isSurvey}
          onBack={handleBack}
          onCreated={handleCreated}
        />
      )}

      {path === 'ai' && (
        <AICreation
          isSurvey={isSurvey}
          onBack={handleBack}
          onCreated={handleCreated}
        />
      )}
    </Modal>
  );
}

// ============================================================
// Path Chooser
// ============================================================
function PathChooser({ isSurvey, onScratch, onTemplates, onAI }: {
  isSurvey: boolean;
  onScratch: () => void;
  onTemplates: () => void;
  onAI: () => void;
}) {
  const typeLabel = isSurvey ? 'survey' : 'form';
  const paths = [
    {
      icon: Plus,
      title: 'Start from scratch',
      desc: `Create a completely customizable ${typeLabel}.`,
      onClick: onScratch,
    },
    {
      icon: LayoutTemplate,
      title: 'Use a template',
      desc: `Choose from a template and customize it.`,
      onClick: onTemplates,
    },
    {
      icon: Sparkles,
      title: 'Build with AI',
      desc: `Describe the ${typeLabel} you want and let SYNAPSE generate the starting structure.`,
      onClick: onAI,
    },
  ];

  return (
    <div className="space-y-3">
      {paths.map(p => (
        <button
          key={p.title}
          onClick={p.onClick}
          className="w-full flex items-center gap-4 p-4 rounded-xl border border-navy-100 hover:border-gold-300 hover:bg-gold-50/30 transition-all text-left group"
        >
          <div className="w-12 h-12 rounded-xl bg-navy-50 flex items-center justify-center shrink-0 group-hover:bg-gold-100 transition-colors">
            <p.icon className="w-6 h-6 text-navy-600 group-hover:text-gold-700" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-navy-800">{p.title}</p>
            <p className="text-xs text-ivory-600 mt-0.5">{p.desc}</p>
          </div>
          <ChevronRight className="w-5 h-5 text-ivory-400 group-hover:text-gold-600 transition-colors" />
        </button>
      ))}
    </div>
  );
}

// ============================================================
// Start from Scratch
// ============================================================
function ScratchForm({ isSurvey, onBack, onCreated }: {
  isSurvey: boolean;
  onBack: () => void;
  onCreated: (formId: string) => void;
}) {
  const { workspace, user } = useAuth();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!workspace || !name.trim()) return;
    setCreating(true);
    const { data, error: err } = await supabase.from('forms').insert({
      workspace_id: workspace.id,
      owner_id: user?.id ?? null,
      name: name.trim(),
      description: description.trim() || null,
      type: isSurvey ? 'survey' : 'form',
      status: 'draft',
      success_message: 'Thank you for your submission.',
    }).select().single();

    if (err) { toast(err.message, 'error'); setCreating(false); return; }

    const fields: TemplateField[] = DEFAULT_CONTACT_FIELDS;
    if (fields.length > 0) {
      await supabase.from('form_fields').insert(fields.map((f, i) => ({
        form_id: data.id,
        label: f.label,
        field_type: f.field_type,
        required: f.required,
        placeholder: f.placeholder ?? null,
        help_text: f.help_text ?? null,
        default_value: null,
        options: f.options ?? null,
        sort_order: i,
        mapped_field: f.mapped_field ?? null,
      })));
    }

    toast(`${isSurvey ? 'Survey' : 'Form'} created`);
    setCreating(false);
    onCreated(data.id);
  };

  return (
    <div>
      <div className="mb-5 flex items-center gap-2">
        <button onClick={onBack} className="btn-ghost btn-sm">
          <ChevronLeft className="w-4 h-4" />
          Back
        </button>
        <div className="flex items-center gap-2 text-sm">
          <span className="w-7 h-7 rounded-lg bg-gold-100 flex items-center justify-center">
            <Plus className="w-4 h-4 text-gold-700" />
          </span>
          <span className="font-semibold text-navy-800">Start from scratch</span>
        </div>
      </div>

      <div className="space-y-4 max-w-lg">
        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1.5">
            {isSurvey ? 'Survey' : 'Form'} Name
          </label>
          <input
            className="input-field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Client Intake Form"
            autoFocus
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1.5">
            Description <span className="text-ivory-400 font-normal">(optional)</span>
          </label>
          <textarea
            className="input-field min-h-[80px] resize-y"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Tell us a little about yourself before your consultation."
          />
        </div>

        <div className="rounded-xl bg-ivory-50 border border-navy-100 p-4">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-4 h-4 text-navy-600" />
            <p className="text-sm font-semibold text-navy-700">Default fields included</p>
          </div>
          <p className="text-xs text-ivory-600 mb-3">
            Your {isSurvey ? 'survey' : 'form'} will start with these contact fields. You can edit, delete, or reorder any of them in the builder.
          </p>
          <div className="space-y-1.5">
            {DEFAULT_CONTACT_FIELDS.map(f => (
              <div key={f.label} className="flex items-center gap-2 text-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-gold-400" />
                <span className="font-medium text-navy-700">{f.label}</span>
                <span className="text-ivory-500">· {FIELD_TYPE_METADATA[f.field_type].label}</span>
                {f.required && <span className="text-ivory-400">· Required</span>}
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button onClick={onBack} className="btn-secondary">Back</button>
          <button
            onClick={handleCreate}
            className="btn-primary"
            disabled={!name.trim() || creating}
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
            Create & Open Builder
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Template Gallery
// ============================================================
function TemplateGallery({ isSurvey, onBack, onSelect }: {
  isSurvey: boolean;
  onBack: () => void;
  onSelect: (tpl: FormTemplate) => void;
}) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<TemplateCategory | 'All'>('All');

  const templates = useMemo(() => {
    return FORM_TEMPLATES.filter(t => {
      if (isSurvey && t.type === 'form') return false;
      if (!isSurvey && t.type === 'survey') return false;
      if (category !== 'All' && t.category !== category) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!t.name.toLowerCase().includes(q) && !t.description.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [isSurvey, category, search]);

  const availableCategories = useMemo(() => {
    const cats = new Set(FORM_TEMPLATES
      .filter(t => isSurvey ? t.type !== 'form' : t.type !== 'survey')
      .map(t => t.category));
    return ['All', ...TEMPLATE_CATEGORIES.filter(c => cats.has(c))] as (TemplateCategory | 'All')[];
  }, [isSurvey]);

  return (
    <div>
      <div className="mb-5 flex items-center gap-2">
        <button onClick={onBack} className="btn-ghost btn-sm">
          <ChevronLeft className="w-4 h-4" />
          Back
        </button>
        <div className="flex items-center gap-2 text-sm">
          <span className="w-7 h-7 rounded-lg bg-gold-100 flex items-center justify-center">
            <LayoutTemplate className="w-4 h-4 text-gold-700" />
          </span>
          <span className="font-semibold text-navy-800">Use a template</span>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-ivory-600" />
        <input
          className="input-field pl-10"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search templates..."
        />
      </div>

      {/* Categories */}
      <div className="flex flex-wrap gap-1.5 mb-5">
        {availableCategories.map(cat => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
              category === cat
                ? 'bg-navy-800 text-ivory-100'
                : 'bg-white text-ivory-600 border border-navy-100 hover:bg-ivory-50'
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Template cards */}
      {templates.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-sm text-ivory-600">No templates found. Try a different search or category.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {templates.map(tpl => (
            <button
              key={tpl.id}
              onClick={() => onSelect(tpl)}
              className="text-left p-4 rounded-xl border border-navy-100 hover:border-gold-300 hover:bg-gold-50/30 transition-all group flex flex-col"
            >
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-navy-50 flex items-center justify-center shrink-0 group-hover:bg-gold-100 transition-colors">
                  {tpl.type === 'survey'
                    ? <BarChart3 className="w-5 h-5 text-navy-600 group-hover:text-gold-700" />
                    : <FileText className="w-5 h-5 text-navy-600 group-hover:text-gold-700" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-navy-800 truncate">{tpl.name}</p>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-gold-700 mt-0.5">{tpl.category}</p>
                </div>
              </div>
              <p className="text-xs text-ivory-600 line-clamp-2 mb-3 flex-1">{tpl.description}</p>
              <div className="flex items-center justify-between">
                <span className="text-xs text-ivory-500">{tpl.fields.length} fields</span>
                <span className="text-xs font-semibold text-gold-700 group-hover:text-gold-600 flex items-center gap-1">
                  Preview <ChevronRight className="w-3 h-3" />
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Template Preview
// ============================================================
function TemplatePreview({ template, isSurvey, onBack, onCreated }: {
  template: FormTemplate;
  isSurvey: boolean;
  onBack: () => void;
  onCreated: (formId: string) => void;
}) {
  const { workspace, user } = useAuth();
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);

  const handleUse = async () => {
    if (!workspace) return;
    setCreating(true);
    const { data, error: err } = await supabase.from('forms').insert({
      workspace_id: workspace.id,
      owner_id: user?.id ?? null,
      name: template.name,
      description: template.description,
      type: isSurvey ? 'survey' : 'form',
      status: 'draft',
      success_message: 'Thank you for your submission.',
    }).select().single();

    if (err) { toast(err.message, 'error'); setCreating(false); return; }

    if (template.fields.length > 0) {
      await supabase.from('form_fields').insert(template.fields.map((f, i) => ({
        form_id: data.id,
        label: f.label,
        field_type: f.field_type,
        required: f.required,
        placeholder: f.placeholder ?? null,
        help_text: f.help_text ?? null,
        default_value: null,
        options: f.options ?? null,
        sort_order: i,
        mapped_field: f.mapped_field ?? null,
      })));
    }

    toast(`${isSurvey ? 'Survey' : 'Form'} created from template`);
    setCreating(false);
    onCreated(data.id);
  };

  return (
    <div>
      <div className="mb-5 flex items-center gap-2">
        <button onClick={onBack} className="btn-ghost btn-sm">
          <ChevronLeft className="w-4 h-4" />
          Back to templates
        </button>
        <div className="flex items-center gap-2 text-sm">
          <span className="w-7 h-7 rounded-lg bg-gold-100 flex items-center justify-center">
            <Eye className="w-4 h-4 text-gold-700" />
          </span>
          <span className="font-semibold text-navy-800">Template Preview</span>
        </div>
      </div>

      {/* Template header */}
      <div className="rounded-xl bg-ivory-50 border border-navy-100 p-5 mb-5">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-xl bg-navy-100 flex items-center justify-center shrink-0">
            {template.type === 'survey'
              ? <BarChart3 className="w-6 h-6 text-navy-700" />
              : <FileText className="w-6 h-6 text-navy-700" />}
          </div>
          <div>
            <h3 className="text-lg font-semibold text-navy-800">{template.name}</h3>
            <p className="text-sm text-ivory-600 mt-0.5">{template.description}</p>
            <div className="flex items-center gap-3 mt-2 text-xs text-ivory-500">
              <span className="inline-flex items-center gap-1">
                <FileText className="w-3 h-3" />
                {template.fields.length} fields
              </span>
              <span className="px-2 py-0.5 rounded-md bg-gold-100 text-gold-700 font-medium">{template.category}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Field list */}
      <div className="space-y-2 mb-6">
        {template.fields.map((field, idx) => {
          const meta = FIELD_TYPE_METADATA[field.field_type as FormFieldType];
          return (
            <div key={idx} className="flex items-center gap-3 p-3 rounded-xl border border-navy-100">
              <span className="w-6 h-6 rounded-md bg-navy-50 text-navy-600 text-xs font-bold flex items-center justify-center shrink-0">
                {idx + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-navy-800 truncate">{field.label}</p>
                  {field.required && (
                    <span className="text-[10px] font-semibold text-burgundy-500 px-1.5 py-0.5 rounded bg-red-50">Required</span>
                  )}
                </div>
                <p className="text-xs text-ivory-500">{meta?.label ?? field.field_type}</p>
              </div>
              {field.options && field.options.length > 0 && (
                <div className="hidden sm:flex items-center gap-1 flex-wrap justify-end max-w-[200px]">
                  {field.options.slice(0, 3).map((opt, oi) => (
                    <span key={oi} className="text-[10px] px-1.5 py-0.5 rounded bg-ivory-100 text-ivory-600">{opt}</span>
                  ))}
                  {field.options.length > 3 && <span className="text-[10px] text-ivory-400">+{field.options.length - 3}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between border-t border-navy-100 pt-4">
        <p className="text-xs text-ivory-500">A new editable copy will be created. The original template stays unchanged.</p>
        <button onClick={handleUse} className="btn-primary" disabled={creating}>
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Use Template
        </button>
      </div>
    </div>
  );
}

// ============================================================
// AI Creation
// ============================================================
function AICreation({ isSurvey, onBack, onCreated }: {
  isSurvey: boolean;
  onBack: () => void;
  onCreated: (formId: string) => void;
}) {
  const { workspace, user } = useAuth();
  const { toast } = useToast();
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<{ name: string; description: string; fields: TemplateField[] } | null>(null);

  const suggestions = isSurvey ? AI_SUGGESTIONS_SURVEY : AI_SUGGESTIONS_FORM;

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setGenerated(null);

    try {
      const result = generateFormWithAI(prompt.trim(), isSurvey);
      setGenerated(result);
    } catch {
      toast('Could not generate form. Please try a different prompt.', 'error');
    }
    setGenerating(false);
  };

  const handleCreate = async () => {
    if (!workspace || !generated) return;
    setGenerating(true);
    const { data, error: err } = await supabase.from('forms').insert({
      workspace_id: workspace.id,
      owner_id: user?.id ?? null,
      name: generated.name,
      description: generated.description,
      type: isSurvey ? 'survey' : 'form',
      status: 'draft',
      success_message: 'Thank you for your submission.',
    }).select().single();

    if (err) { toast(err.message, 'error'); setGenerating(false); return; }

    if (generated.fields.length > 0) {
      await supabase.from('form_fields').insert(generated.fields.map((f, i) => ({
        form_id: data.id,
        label: f.label,
        field_type: f.field_type,
        required: f.required,
        placeholder: f.placeholder ?? null,
        help_text: f.help_text ?? null,
        default_value: null,
        options: f.options ?? null,
        sort_order: i,
        mapped_field: f.mapped_field ?? null,
      })));
    }

    toast(`${isSurvey ? 'Survey' : 'Form'} generated and saved as draft`);
    setGenerating(false);
    onCreated(data.id);
  };

  return (
    <div>
      <div className="mb-5 flex items-center gap-2">
        <button onClick={onBack} className="btn-ghost btn-sm">
          <ChevronLeft className="w-4 h-4" />
          Back
        </button>
        <div className="flex items-center gap-2 text-sm">
          <span className="w-7 h-7 rounded-lg bg-gold-100 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-gold-700" />
          </span>
          <span className="font-semibold text-navy-800">Build with AI</span>
        </div>
      </div>

      {!generated ? (
        <div className="max-w-lg space-y-4">
          <div className="rounded-xl bg-gold-50/50 border border-gold-200 p-4">
            <div className="flex items-start gap-3">
              <Wand2 className="w-5 h-5 text-gold-700 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-navy-700">Describe your {isSurvey ? 'survey' : 'form'}</p>
                <p className="text-xs text-ivory-600 mt-1">
                  The AI will generate a title, description, logical fields, question types, and suggested required fields. The result is a draft you can fully edit.
                </p>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1.5">Prompt</label>
            <textarea
              className="input-field min-h-[100px] resize-y"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={isSurvey
                ? 'e.g. Create a customer satisfaction survey for a consulting company.'
                : 'e.g. Create a client onboarding form for a digital marketing agency.'}
              autoFocus
            />
          </div>

          <div>
            <p className="text-xs font-semibold text-ivory-600 mb-2">Try one of these:</p>
            <div className="flex flex-col gap-1.5">
              {suggestions.map(s => (
                <button
                  key={s}
                  onClick={() => setPrompt(s)}
                  className="text-left text-xs text-navy-600 px-3 py-2 rounded-lg border border-navy-100 hover:border-gold-300 hover:bg-gold-50/30 transition-all"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button onClick={onBack} className="btn-secondary">Back</button>
            <button
              onClick={handleGenerate}
              className="btn-primary"
              disabled={!prompt.trim() || generating}
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Generate {isSurvey ? 'Survey' : 'Form'}
            </button>
          </div>

          {generating && (
            <div className="rounded-xl border border-gold-200 bg-gold-50/30 p-4 text-center">
              <Loader2 className="w-5 h-5 text-gold-700 animate-spin mx-auto mb-2" />
              <p className="text-sm text-navy-700">Generating your {isSurvey ? 'survey' : 'form'} structure...</p>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {/* Generated result */}
          <div className="rounded-xl bg-green-50 border border-green-200 p-3 flex items-center gap-2">
            <Check className="w-4 h-4 text-green-600" />
            <p className="text-sm font-medium text-green-700">
              Generated as a draft. Review the fields below and open the builder to edit.
            </p>
          </div>

          <div className="rounded-xl border border-navy-100 p-5">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-11 h-11 rounded-xl bg-gold-100 flex items-center justify-center shrink-0">
                {isSurvey
                  ? <BarChart3 className="w-5 h-5 text-gold-700" />
                  : <FileText className="w-5 h-5 text-gold-700" />}
              </div>
              <div>
                <h3 className="text-base font-semibold text-navy-800">{generated.name}</h3>
                <p className="text-sm text-ivory-600 mt-0.5">{generated.description}</p>
              </div>
            </div>

            <div className="space-y-2">
              {generated.fields.map((field, idx) => {
                const meta = FIELD_TYPE_METADATA[field.field_type as FormFieldType];
                return (
                  <div key={idx} className="flex items-center gap-3 p-2.5 rounded-lg border border-navy-50 bg-ivory-50/30">
                    <span className="w-5 h-5 rounded-md bg-navy-50 text-navy-600 text-[10px] font-bold flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-navy-800 truncate">{field.label}</p>
                        {field.required && (
                          <span className="text-[10px] font-semibold text-burgundy-500 px-1 py-0.5 rounded bg-red-50">Required</span>
                        )}
                      </div>
                      <p className="text-xs text-ivory-500">{meta?.label ?? field.field_type}</p>
                    </div>
                    {field.options && field.options.length > 0 && (
                      <div className="hidden sm:flex items-center gap-1">
                        {field.options.slice(0, 2).map((opt, oi) => (
                          <span key={oi} className="text-[10px] px-1.5 py-0.5 rounded bg-ivory-100 text-ivory-600">{opt}</span>
                        ))}
                        {field.options.length > 2 && <span className="text-[10px] text-ivory-400">+{field.options.length - 2}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-navy-100 pt-4">
            <button
              onClick={() => { setGenerated(null); setPrompt(''); }}
              className="btn-secondary"
            >
              <X className="w-4 h-4" />
              Discard & try again
            </button>
            <button onClick={handleCreate} className="btn-primary" disabled={generating}>
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              Create & Open Builder
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// AI Generation Logic
// ============================================================
function generateFormWithAI(prompt: string, isSurvey: boolean): { name: string; description: string; fields: TemplateField[] } {
  const p = prompt.toLowerCase();
  const fields: TemplateField[] = [];

  // Contact fields — most forms need these
  const needsContact = /contact|intake|onboard|registration|signup|sign-up|application|consult|lead|quote|request|order/.test(p);
  if (needsContact) {
    fields.push({ label: 'First Name', field_type: 'first_name', required: true, placeholder: 'John', mapped_field: 'first_name' });
    fields.push({ label: 'Last Name', field_type: 'last_name', required: true, placeholder: 'Doe', mapped_field: 'last_name' });
    fields.push({ label: 'Email Address', field_type: 'email', required: true, placeholder: 'john@example.com', mapped_field: 'email' });
    if (/phone|call|sms|text/.test(p) || needsContact) {
      fields.push({ label: 'Phone Number', field_type: 'phone', required: false, placeholder: '+1 (555) 000-0000', mapped_field: 'phone' });
    }
  }

  // Company field
  if (/business|company|agency|corporate|b2b|enterprise|client/.test(p)) {
    fields.push({ label: 'Company Name', field_type: 'text', required: false, placeholder: 'Acme Inc.' });
  }

  // Job / position
  if (/job|application|hiring|recruit|position|career|employment/.test(p)) {
    fields.push({ label: 'Position Applied For', field_type: 'text', required: true, placeholder: 'e.g. Marketing Manager' });
    fields.push({ label: 'Years of Experience', field_type: 'number', required: true, placeholder: '5' });
    fields.push({ label: 'Resume / Portfolio URL', field_type: 'text', required: false, placeholder: 'https://' });
    fields.push({ label: 'Cover Letter', field_type: 'long_text', required: false, placeholder: 'Tell us why you are a good fit' });
  }

  // Event / webinar
  if (/event|webinar|conference|meetup|workshop|ticket/.test(p)) {
    fields.push({ label: 'Number of Guests', field_type: 'number', required: true, placeholder: '1' });
    fields.push({
      label: 'Dietary Restrictions',
      field_type: 'dropdown',
      required: false,
      options: ['None', 'Vegetarian', 'Vegan', 'Gluten-Free', 'Other'],
    });
  }

  // Feedback / survey / rating
  if (/feedback|satisfaction|survey|review|rating|csat|nps/.test(p)) {
    fields.push({
      label: 'Overall Satisfaction',
      field_type: 'radio',
      required: true,
      options: ['Very Satisfied', 'Satisfied', 'Neutral', 'Dissatisfied', 'Very Dissatisfied'],
    });
    fields.push({
      label: 'How likely are you to recommend us?',
      field_type: 'radio',
      required: isSurvey,
      options: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
    });
    fields.push({ label: 'What did you enjoy most?', field_type: 'long_text', required: false, placeholder: 'Share your thoughts...' });
    fields.push({ label: 'What could we improve?', field_type: 'long_text', required: false, placeholder: 'Help us improve' });
  }

  // Marketing / lead
  if (/lead|marketing|sales|quote|demo|inquiry|enquiry/.test(p)) {
    fields.push({
      label: 'What are you interested in?',
      field_type: 'radio',
      required: true,
      options: ['Product Demo', 'Pricing Information', 'Consultation', 'General Inquiry'],
    });
    fields.push({
      label: 'Budget Range',
      field_type: 'dropdown',
      required: false,
      options: ['Under $1k', '$1k - $5k', '$5k - $10k', '$10k+'],
    });
  }

  // Service request
  if (/service|request|appointment|booking|schedule/.test(p)) {
    fields.push({
      label: 'Preferred Date',
      field_type: 'date',
      required: true,
    });
    fields.push({
      label: 'Preferred Time',
      field_type: 'time',
      required: true,
    });
    fields.push({
      label: 'Service Type',
      field_type: 'dropdown',
      required: true,
      options: ['Consultation', 'Assessment', 'Full Service', 'Other'],
    });
  }

  // Always add an open-ended question for forms
  if (!isSurvey && needsContact) {
    fields.push({
      label: 'Additional Information',
      field_type: 'long_text',
      required: false,
      placeholder: 'Is there anything else we should know?',
    });
  }

  // Consent for forms that collect contact info
  if (needsContact && !isSurvey) {
    fields.push({
      label: 'Consent',
      field_type: 'consent',
      required: true,
      help_text: 'I agree to be contacted regarding my submission.',
    });
  }

  // Fallback — if nothing matched, create basic fields
  if (fields.length === 0) {
    fields.push({ label: 'Name', field_type: 'text', required: true, placeholder: 'Your name' });
    fields.push({ label: 'Email Address', field_type: 'email', required: true, placeholder: 'you@example.com', mapped_field: 'email' });
    if (isSurvey) {
      fields.push({
        label: 'Question 1',
        field_type: 'radio',
        required: true,
        options: ['Option A', 'Option B', 'Option C'],
      });
      fields.push({ label: 'Additional Comments', field_type: 'long_text', required: false });
    } else {
      fields.push({ label: 'Message', field_type: 'long_text', required: true, placeholder: 'Tell us more...' });
    }
  }

  // Generate name and description from prompt
  const cleanPrompt = prompt.replace(/^(create|build|make|design|generate)\s+(a\s+)?/i, '').replace(/\.$/, '');
  const name = isSurvey
    ? capitalize(cleanPrompt.replace(/survey/gi, '').trim() || 'New Survey') + ' Survey'
    : capitalize(cleanPrompt.replace(/form/gi, '').trim() || 'New Form') + ' Form';

  const description = isSurvey
    ? `AI-generated survey based on: "${prompt.trim()}"`
    : `AI-generated form based on: "${prompt.trim()}"`;

  return { name: name.replace(/\s+/g, ' ').trim(), description, fields };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
