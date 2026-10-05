import { useEffect, useState, useRef } from 'react';
import { Sparkles, Send, Users } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import type { Contact, Appointment, Calendar as CalendarType, Form, Workflow as WorkflowType, Recording } from '@/types';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  data?: unknown;
}

const SUGGESTED_PROMPTS = [
  "Show today's appointments",
  "Find contacts who booked last week",
  "Summarize my upcoming appointments",
  "Show clients who haven't been contacted",
  "What forms have the most submissions?",
  "Which workflows are active?",
];

export function AIAgentPage() {
  const { workspace, profile } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // A question handed over from Today (#/ai-hub?q=…) starts in the box.
  const [input, setInput] = useState(() => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('q') ?? '');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages([{
      role: 'assistant',
      content: `Hello ${profile?.first_name || 'there'}! I'm your SYNAPSE AI assistant. I can help you find appointments, contacts, forms, workflows, and recordings. Try one of the suggestions below or ask me anything.`,
    }]);
  }, [profile]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (text?: string) => {
    const query = text ?? input;
    if (!query.trim() || loading) return;
    setInput('');
    setLoading(true);

    const userMsg: ChatMessage = { role: 'user', content: query };
    setMessages(prev => [...prev, userMsg]);

    const response = await processQuery(query, workspace?.id ?? '');

    setMessages(prev => [...prev, { role: 'assistant', content: response.content, data: response.data }]);
    setLoading(false);
  };

  async function processQuery(query: string, workspaceId: string): Promise<{ content: string; data?: unknown }> {
    const q = query.toLowerCase();

    try {
      if (q.includes('today') && (q.includes('appointment') || q.includes('meeting'))) {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        const { data } = await supabase
          .from('appointments')
          .select('*, contacts(*), calendars(*)')
          .eq('workspace_id', workspaceId)
          .in('status', ['confirmed', 'pending'])
          .gte('start_time', todayStart.toISOString())
          .lte('start_time', todayEnd.toISOString())
          .order('start_time', { ascending: true });

        const appts = (data ?? []) as (Appointment & { contacts: Contact | null; calendars: CalendarType | null })[];
        if (appts.length === 0) return { content: "You have no appointments scheduled for today." };
        const list = appts.map(a => `• ${new Date(a.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} — ${a.contacts?.first_name ?? ''} ${a.contacts?.last_name ?? ''} — ${a.title} (${a.calendars?.name ?? ''})`).join('\n');
        return {
          content: `You have ${appts.length} appointment${appts.length > 1 ? 's' : ''} today:\n\n${list}`,
          data: appts,
        };
      }

      if (q.includes('upcoming') && q.includes('appointment')) {
        const { data } = await supabase
          .from('appointments')
          .select('*, contacts(*), calendars(*)')
          .eq('workspace_id', workspaceId)
          .in('status', ['confirmed', 'pending'])
          .gte('start_time', new Date().toISOString())
          .order('start_time', { ascending: true })
          .limit(5);

        const appts = (data ?? []) as (Appointment & { contacts: Contact | null; calendars: CalendarType | null })[];
        if (appts.length === 0) return { content: "You have no upcoming appointments." };
        const list = appts.map(a => `• ${new Date(a.start_time).toLocaleDateString()} at ${new Date(a.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} — ${a.contacts?.first_name ?? ''} ${a.contacts?.last_name ?? ''} — ${a.title}`).join('\n');
        return { content: `Here are your next ${appts.length} upcoming appointments:\n\n${list}` };
      }

      if (q.includes('contact') && (q.includes('find') || q.includes('show') || q.includes('who'))) {
        const { data } = await supabase
          .from('contacts')
          .select('*')
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: false })
          .limit(10);

        const contacts = (data ?? []) as Contact[];
        if (contacts.length === 0) return { content: "You have no contacts yet." };
        const list = contacts.map(c => `• ${c.first_name ?? ''} ${c.last_name ?? ''} — ${c.email ?? 'No email'}`).join('\n');
        return { content: `Here are your ${contacts.length} most recent contacts:\n\n${list}` };
      }

      if (q.includes('form') && (q.includes('submission') || q.includes('most'))) {
        const { data } = await supabase
          .from('forms')
          .select('*, form_submissions(count)')
          .eq('workspace_id', workspaceId)
          .order('updated_at', { ascending: false });

        const forms = (data ?? []) as (Form & { form_submissions: { count: number }[] })[];
        if (forms.length === 0) return { content: "You have no forms yet." };
        const list = forms.map(f => `• ${f.name} — ${f.form_submissions?.[0]?.count ?? 0} submissions (${f.status})`).join('\n');
        return { content: `Here are your forms:\n\n${list}` };
      }

      if (q.includes('workflow') && (q.includes('active') || q.includes('show') || q.includes('which'))) {
        const { data } = await supabase
          .from('workflows')
          .select('*')
          .eq('workspace_id', workspaceId)
          .eq('status', 'active')
          .order('created_at', { ascending: false });

        const workflows = (data ?? []) as WorkflowType[];
        if (workflows.length === 0) return { content: "You have no active workflows. Go to the Workflows page to create one." };
        const list = workflows.map(w => `• ${w.name} — Trigger: ${w.trigger_type.replace(/_/g, ' ')} — ${w.total_runs} runs`).join('\n');
        return { content: `You have ${workflows.length} active workflow${workflows.length > 1 ? 's' : ''}:\n\n${list}` };
      }

      if (q.includes('recording')) {
        const { data } = await supabase
          .from('recordings')
          .select('*')
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: false })
          .limit(5);

        const recordings = (data ?? []) as Recording[];
        if (recordings.length === 0) return { content: "You have no recordings yet." };
        const list = recordings.map(r => `• ${r.title} — ${r.status}`).join('\n');
        return { content: `Here are your ${recordings.length} most recent recordings:\n\n${list}` };
      }

      if (q.includes("haven't been contacted") || q.includes('not contacted')) {
        const { data: contacts } = await supabase
          .from('contacts')
          .select('*')
          .eq('workspace_id', workspaceId)
          .order('last_activity_at', { ascending: true })
          .limit(5);

        const stale = (contacts ?? []) as Contact[];
        if (stale.length === 0) return { content: "No contacts found." };
        const list = stale.map(c => `• ${c.first_name ?? ''} ${c.last_name ?? ''} — Last activity: ${new Date(c.last_activity_at).toLocaleDateString()}`).join('\n');
        return { content: `Here are contacts who haven't been contacted recently:\n\n${list}` };
      }

      return { content: "I can help you with appointments, contacts, forms, workflows, and recordings. Try asking:\n\n• \"Show today's appointments\"\n• \"Find contacts\"\n• \"Which workflows are active?\"\n• \"Show my recordings\"" };
    } catch {
      return { content: "I couldn't process that request. Please try again." };
    }
  }

  return (
    <div className="max-w-3xl mx-auto h-[calc(100vh-140px)] flex flex-col">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-navy-800 flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-gold-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-navy-800">AI Hub</h1>
          <p className="text-sm text-ivory-600">Your intelligent assistant for SYNAPSE</p>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-4 pb-4">
        {messages.map((msg, i) => (
          <div key={i} className={cn('flex gap-3', msg.role === 'user' && 'flex-row-reverse')}>
            <div className={cn(
              'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
              msg.role === 'assistant' ? 'bg-navy-800' : 'bg-ivory-200'
            )}>
              {msg.role === 'assistant' ? <Sparkles className="w-4 h-4 text-gold-400" /> : <Users className="w-4 h-4 text-navy-600" />}
            </div>
            <div className={cn(
              'rounded-2xl px-4 py-3 max-w-[80%] whitespace-pre-wrap',
              msg.role === 'assistant' ? 'bg-white border border-navy-100 text-navy-700' : 'bg-navy-800 text-ivory-100'
            )}>
              <p className="text-sm leading-relaxed">{msg.content}</p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-lg bg-navy-800 flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4 text-gold-400" />
            </div>
            <div className="bg-white border border-navy-100 rounded-2xl px-4 py-3">
              <div className="flex gap-1">
                <span className="w-2 h-2 rounded-full bg-ivory-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 rounded-full bg-ivory-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 rounded-full bg-ivory-400 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Suggested prompts */}
      {messages.length <= 1 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {SUGGESTED_PROMPTS.map(p => (
            <button
              key={p}
              onClick={() => handleSend(p)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white text-navy-600 border border-navy-100 hover:bg-ivory-50 transition-all"
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="flex gap-2 pb-2">
        <input
          className="input-field flex-1"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Ask me anything about your appointments, contacts, forms..."
          disabled={loading}
        />
        <button onClick={() => handleSend()} disabled={loading || !input.trim()} className="btn-primary shrink-0">
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
