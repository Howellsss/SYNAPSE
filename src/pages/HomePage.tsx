import { useState } from 'react';
import {
  Bot, Brain, CalendarClock, Check, ChevronRight, Lock, MessageSquare, MessagesSquare, Mic, MonitorPlay, MonitorUp, Shield, Users, Video, Workflow,
} from 'lucide-react';
import { useRouter } from '@/lib/router';
import { HowellsLogo } from '@/components/layout/Sidebar';
import { cn } from '@/lib/utils';

const people = [
  { img: '/p1.webp', name: 'Sofia Reyes', speaking: true },
  { img: '/p2.webp', name: 'Arjun Patel' },
  { img: '/p3.webp', name: 'Maya Johnson', hand: true },
  { img: '/p4.webp', name: 'Liam Murphy' },
  { img: '/p5.webp', name: 'Yuki Tanaka' },
  { img: '/p6.webp', name: 'Karim Hassan' },
];

/** The public home page: what visitors see before signing in. */
export function HomePage() {
  const [, navigate] = useRouter();
  const signIn = () => navigate('/signin');
  const signUp = () => navigate('/signup');
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="min-h-screen bg-white text-navy-800">
      <header className="sticky top-0 z-30 border-b border-navy-100/70 bg-white/80 backdrop-blur-xl backdrop-saturate-150">
        <nav aria-label="Site" className="mx-auto flex h-[52px] max-w-[1040px] items-center gap-6 px-5">
          <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-navy-800 text-white"><HowellsLogo className="h-4 w-4" /></span>
            <span className="text-xs font-semibold tracking-[0.14em]">SYNAPSE</span>
          </button>
          <div className="hidden flex-1 justify-center gap-8 text-[13px] md:flex">
            {[['meetings', 'Meetings'], ['workspaces', 'Workspaces'], ['crm', 'CRM'], ['calendar', 'Calendar'], ['start', 'Pricing']].map(([id, label]) => (
              <button key={id} type="button" onClick={() => jump(id)} className="text-navy-700 transition-colors hover:text-navy-900">{label}</button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-4 md:ml-0">
            <button type="button" onClick={signIn} className="text-[13px] text-navy-700 hover:text-navy-900">Sign in</button>
            <button type="button" onClick={signUp} className="h-8 rounded-full bg-gold-400 px-4 text-[13px] font-semibold text-navy-900 transition-colors hover:bg-gold-300">Get started</button>
          </div>
        </nav>
      </header>

      <main>
        {/* Hero */}
        <section className="flex flex-col items-center px-5 pt-20 text-center sm:pt-24">
          <p className="text-lg font-semibold text-gold-700 sm:text-[21px]">SYNAPSE</p>
          <h1 className="mt-3 max-w-[980px] text-[44px] font-bold leading-[1.05] tracking-[-0.04em] sm:text-[64px] lg:text-[80px]">
            Your whole business.<br />One calm place.
          </h1>
          <p className="mt-5 max-w-[680px] text-lg leading-snug text-ivory-700 sm:text-2xl">
            Contacts, calendar, meetings and a living office, designed to work as one.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-7 gap-y-4">
            <button type="button" onClick={signUp} className="h-12 rounded-full bg-gold-400 px-7 text-[17px] font-semibold text-navy-900 transition-colors hover:bg-gold-300">Start free</button>
            <button type="button" onClick={() => jump('meetings')} className="inline-flex items-center gap-0.5 text-[17px] text-gold-700 hover:underline">See how it works <ChevronRight className="h-4 w-4" /></button>
          </div>
          <p className="mt-4 text-sm text-ivory-700">Free to start. No credit card.</p>

          {/* The product, working */}
          <div className="mt-14 w-full max-w-[1180px]"><MeetingMock /></div>
        </section>

        <section className="mx-auto max-w-[1040px] px-5 pb-10 pt-28 sm:pt-36">
          <h2 className="max-w-[760px] text-[34px] font-bold leading-[1.08] tracking-[-0.035em] sm:text-[56px]">
            Everything you were juggling. <span className="text-ivory-700">Now in one place that just works.</span>
          </h2>
        </section>

        {/* Highlights */}
        <section aria-label="Highlights" className="mx-auto grid max-w-[1080px] grid-cols-1 gap-5 px-5 md:grid-cols-6">
          <article id="meetings" className="relative min-h-[460px] scroll-mt-20 overflow-hidden rounded-[30px] bg-navy-900 text-white md:col-span-4 md:min-h-[560px]">
            <img src="/p3.webp" alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover opacity-80" />
            <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/60 to-transparent p-8 sm:p-10">
              <p className="text-[17px] font-semibold text-gold-300">Meetings</p>
              <h3 className="mt-2 max-w-[460px] text-[32px] font-bold leading-[1.08] tracking-[-0.03em] sm:text-[40px]">Face to face, from anywhere.</h3>
            </div>
            <div className="absolute inset-x-8 bottom-8 flex flex-wrap gap-2.5 sm:inset-x-10 sm:bottom-10">
              {['Draw on a shared screen', 'Your iPhone as the camera', 'No downloads'].map((t) => (
                <span key={t} className="rounded-full bg-black/55 px-3.5 py-2 text-sm backdrop-blur-md">{t}</span>
              ))}
            </div>
          </article>

          <article className="flex min-h-[420px] flex-col justify-between rounded-[30px] bg-paper px-8 py-10 text-center md:col-span-2 md:min-h-[560px]">
            <div>
              <p className="text-[17px] font-semibold text-gold-700">Privacy</p>
              <h3 className="mt-2 text-[30px] font-bold leading-tight tracking-[-0.025em]">Encrypted. Yours.</h3>
            </div>
            <span aria-hidden="true" className="mx-auto flex h-36 w-36 items-center justify-center rounded-full bg-white"><Lock className="h-14 w-14 stroke-[1.4]" /></span>
            <p className="text-[17px] leading-snug text-ivory-700">Calls are encrypted in transit. Only people in your account can join your rooms.</p>
          </article>

          <article id="workspaces" className="scroll-mt-20 overflow-hidden rounded-[30px] bg-paper md:col-span-6">
            <div className="flex flex-col items-center px-8 pt-12 text-center sm:pt-14">
              <p className="text-[17px] font-semibold text-gold-700">Workspaces</p>
              <h3 className="mt-2 max-w-[640px] text-[32px] font-bold leading-[1.08] tracking-[-0.03em] sm:text-[44px]">An office you can walk into.</h3>
              <p className="mt-3 max-w-[560px] text-[17px] leading-snug text-ivory-700 sm:text-[19px]">Walk over to talk. Step into a room for privacy. Reception, lounges and meeting rooms, all online.</p>
            </div>
            <img
              src="/landing/office.webp"
              alt="A SYNAPSE workspace seen from above: a reception desk, a lounge, glass meeting rooms and people talking in them"
              loading="lazy"
              className="mx-auto mt-6 w-full max-w-[1000px] px-4 mix-blend-multiply sm:px-8"
            />
          </article>

          <article id="crm" className="flex min-h-[440px] scroll-mt-20 flex-col gap-7 rounded-[30px] bg-paper p-8 sm:p-10 md:col-span-3">
            <div>
              <p className="text-[17px] font-semibold text-gold-700">Contacts</p>
              <h3 className="mt-2 text-[30px] font-bold leading-[1.08] tracking-[-0.03em] sm:text-[36px]">Every conversation, one timeline.</h3>
              <p className="mt-3 text-[17px] leading-snug text-ivory-700">Email, texts, forms, calls and meetings, all on the person they belong to.</p>
            </div>
            <div className="flex-1 rounded-2xl border border-navy-100 bg-white p-5">
              <div className="flex items-center gap-3">
                <img src="/p4.webp" alt="" loading="lazy" className="h-11 w-11 rounded-full object-cover" />
                <span className="flex flex-col"><strong className="font-semibold">Liam Murphy</strong><span className="text-[13px] text-ivory-700">Proposal sent</span></span>
              </div>
              <ul className="mt-4 space-y-2.5 text-sm">
                <li className="flex items-baseline gap-2.5"><span className="h-2 w-2 shrink-0 rounded-full bg-gold-400" />Meeting today at 10:30</li>
                <li className="flex items-baseline gap-2.5 text-ivory-700"><span className="h-2 w-2 shrink-0 rounded-full bg-navy-200" />Opened your proposal</li>
                <li className="flex items-baseline gap-2.5 text-ivory-700"><span className="h-2 w-2 shrink-0 rounded-full bg-navy-200" />Replied by text: “Looks great.”</li>
              </ul>
            </div>
          </article>

          <article id="calendar" className="flex min-h-[440px] scroll-mt-20 flex-col items-center gap-6 rounded-[30px] bg-paper p-8 text-center sm:p-10 md:col-span-3">
            <p className="text-[17px] font-semibold text-gold-700">Calendar</p>
            <span aria-hidden="true" className="flex h-36 w-36 flex-col items-center justify-center rounded-[30px] bg-white shadow-[0_12px_30px_rgba(0,0,0,0.08)]">
              <span className="text-sm font-semibold text-burgundy-500">WED</span>
              <span className="font-display text-[68px] font-semibold leading-none tracking-[-0.04em]">14</span>
            </span>
            <h3 className="max-w-[380px] text-[28px] font-bold leading-tight tracking-[-0.025em]">Booking pages that fill your week.</h3>
            <p className="max-w-[380px] text-[17px] leading-snug text-ivory-700">Share a link. People pick a time. Reminders go out on their own.</p>
          </article>
        </section>

        <div className="mt-28 sm:mt-36"><Tour /></div>

        {/* Six modules */}
        <section aria-label="Modules" className="mx-auto max-w-[1080px] px-5 pt-28 sm:pt-36">
          <h2 className="text-center text-[34px] font-bold leading-[1.08] tracking-[-0.035em] sm:text-[48px]">Everything you need. Nothing you don’t.</h2>
          <p className="mx-auto mt-4 max-w-[620px] text-center text-lg text-ivory-700 sm:text-[21px]">Six modules that replace a dozen disconnected tools.</p>
          <div className="mt-12 grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
            {MODULES.map((m) => (
              <div key={m.title}>
                <m.icon className="h-7 w-7 stroke-[1.6] text-gold-700" />
                <h3 className="mt-4 text-[21px] font-semibold tracking-[-0.015em]">{m.title}</h3>
                <p className="mt-2 text-[17px] leading-snug text-ivory-700">{m.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* In depth */}
        <section aria-label="In depth" className="mx-auto max-w-[1080px] px-5 pt-28 sm:pt-36">
          <h2 className="max-w-[760px] text-[34px] font-bold leading-[1.08] tracking-[-0.035em] sm:text-[48px]">A complete operating system for your work.</h2>
          <p className="mt-4 max-w-[680px] text-lg text-ivory-700 sm:text-[21px]">From scheduling to automation, everything works together, so your team switches tools less and does more.</p>
          <div className="mt-12 grid gap-5 md:grid-cols-2">
            {DETAILS.map((d) => (
              <article key={d.title} className="rounded-[30px] bg-paper p-8 sm:p-10">
                <d.icon className="h-7 w-7 stroke-[1.6] text-gold-700" />
                <h3 className="mt-4 text-[26px] font-bold tracking-[-0.025em]">{d.title}</h3>
                <p className="mt-2 text-[17px] leading-snug text-ivory-700">{d.desc}</p>
                <ul className="mt-5 space-y-2.5">
                  {d.points.map((pt) => <li key={pt} className="flex items-center gap-2.5 text-[15px]"><Check className="h-4 w-4 shrink-0 text-gold-700" />{pt}</li>)}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-28 bg-navy-900 px-5 py-28 text-center text-white sm:mt-36 sm:py-36">
          <h2 className="text-[40px] font-bold leading-[1.05] tracking-[-0.04em] sm:text-[64px]">One app. <span className="text-gold-400">Not twelve.</span></h2>
          <p className="mx-auto mt-5 max-w-[640px] text-lg leading-relaxed text-ivory-400 sm:text-[21px]">Booking, email, texting, forms, pipeline, meetings and your team's office. Learn it once, use it all day.</p>
        </section>

        <section id="start" className="flex scroll-mt-20 flex-col items-center px-5 py-28 text-center sm:py-36">
          <h2 className="text-[40px] font-bold leading-[1.07] tracking-[-0.035em] sm:text-[56px]">Ready to enter the future?</h2>
          <p className="mt-4 max-w-[620px] text-lg text-ivory-700 sm:text-[21px]">Join teams building the next generation of remote work. Free to start, no credit card required.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3.5">
            <button type="button" onClick={signUp} className="h-12 rounded-full bg-gold-400 px-7 text-[17px] font-semibold text-navy-900 transition-colors hover:bg-gold-300">Create your SYNAPSE</button>
            <button type="button" onClick={signIn} className="h-12 rounded-full border border-gold-400 px-7 text-[17px] font-semibold text-navy-800 transition-colors hover:bg-paper">Sign in</button>
          </div>
        </section>
      </main>

      <footer className="border-t border-navy-100 bg-paper px-5 py-8 text-xs text-ivory-700">
        <div className="mx-auto flex max-w-[1040px] flex-wrap items-center justify-between gap-3">
          <span>© {new Date().getFullYear()} SYNAPSE. All rights reserved.</span>
          <span className="flex gap-5">
            <button type="button" onClick={signIn} className="hover:text-navy-800">Sign in</button>
            <button type="button" onClick={signUp} className="hover:text-navy-800">Create an account</button>
          </span>
        </div>
      </footer>
    </div>
  );
}

/** The product, working: a live meeting with the six people. */
function MeetingMock() {
  return (
    <figure className="w-full rounded-[28px] bg-navy-800 p-2.5 shadow-[0_40px_100px_rgba(0,0,0,0.22)] sm:p-3.5">
      <div className="rounded-[18px] bg-navy-950 p-2.5 sm:p-3">
        <div className="flex items-center justify-between px-1.5 pb-2.5 text-xs text-ivory-400 sm:text-[13px]">
          <span className="font-semibold text-white">Q4 Strategy Review</span>
          <span className="inline-flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" /> Encrypted · 18:42</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-2.5">
          {people.map((p) => (
            <div key={p.name} className="relative aspect-[16/10] overflow-hidden rounded-xl sm:rounded-[14px]">
              <img src={p.img} alt={p.name + (p.speaking ? ', speaking' : '') + (p.hand ? ', hand raised' : '')} className="h-full w-full object-cover" />
              {p.speaking && <span aria-hidden="true" className="absolute inset-0 rounded-xl ring-[3px] ring-inset ring-gold-400 sm:rounded-[14px]" />}
              {p.hand && <span className="absolute left-2 top-2 rounded-full bg-gold-400 px-2.5 py-1 text-[11px] font-semibold text-navy-900">Hand raised</span>}
              <span className="absolute bottom-2 left-2 rounded-full bg-black/50 px-2.5 py-1 text-[11px] text-white backdrop-blur sm:text-xs">{p.name}</span>
            </div>
          ))}
        </div>
        <div className="flex justify-center pt-3" aria-hidden="true">
          <div className="flex items-center gap-1 rounded-full bg-navy-700/90 p-1.5">
            {[Mic, Video, MonitorUp, MessageSquare].map((Icon, i) => (
              <span key={i} className={cn('flex h-9 w-9 items-center justify-center rounded-full text-white sm:h-10 sm:w-10', i < 2 && 'bg-white/10')}><Icon className="h-4 w-4" /></span>
            ))}
            <span className="ml-1 rounded-full bg-burgundy-500 px-4 py-2 text-xs font-semibold text-white">Leave</span>
          </div>
        </div>
      </div>
    </figure>
  );
}

const MODULES = [
  { icon: Video, title: 'Live meetings', desc: 'HD video in the browser, with annotation, reactions and AI-generated summaries and action items.' },
  { icon: Brain, title: 'AI intelligence', desc: 'Transcription, sentiment and automatic action items from your conversations.' },
  { icon: Users, title: 'Spatial workspaces', desc: 'Move freely in an online office built for deep work and quick chats.' },
  { icon: MessagesSquare, title: 'Team channels', desc: 'Conversations that never sleep, with the full history kept.' },
  { icon: MonitorPlay, title: 'Live webinars', desc: 'Host events for large audiences, with engagement you can measure.' },
  { icon: Shield, title: 'Secure by default', desc: 'Encrypted in transit, with row-level security on every record.' },
];

const DETAILS = [
  { icon: CalendarClock, title: 'Smart scheduling', desc: 'Conflict detection, group bookings, round-robin and buffers. Connect your calendars and let SYNAPSE find the time.', points: ['Group and round-robin bookings', 'Real-time conflict detection', 'Google and Outlook calendar sync', 'Custom buffers and availability'] },
  { icon: Users, title: 'Built-in CRM', desc: 'Every contact, conversation and appointment in one timeline, so you never lose context.', points: ['Contact timelines and history', 'Conversation tracking', 'Custom fields and tags', 'Search across everything'] },
  { icon: Bot, title: 'AI assistant and automation', desc: 'Summarize meetings, pull out action items, draft follow-ups and run workflows.', points: ['Meeting summaries', 'Action items, extracted for you', 'Follow-up drafts', 'A visual workflow builder'] },
  { icon: Workflow, title: 'Security you don’t think about', desc: 'Row-level database security and role-based access protect every layer by default.', points: ['Row-level security policies', 'Encryption in transit', 'Role-based access', 'Audit logs'] },
];

type TourTab = 'sessions' | 'conversations' | 'pulse';

/** "One space. Three ways to flow.": a segmented control over three views. */
function Tour() {
  const [tab, setTab] = useState<TourTab>('sessions');
  const tabs: { id: TourTab; label: string }[] = [{ id: 'sessions', label: 'Sessions' }, { id: 'conversations', label: 'Conversations' }, { id: 'pulse', label: 'Pulse' }];
  return (
    <section aria-label="Tour" className="bg-navy-900 px-5 py-24 text-center text-white sm:py-32">
      <h2 className="text-[36px] font-bold leading-[1.07] tracking-[-0.035em] sm:text-[56px]">One space. Three ways to flow.</h2>
      <p className="mx-auto mt-4 max-w-[640px] text-lg leading-relaxed text-ivory-400 sm:text-[21px]">Run a focus session, keep conversations alive, and watch your team’s pulse, all without leaving the room.</p>
      <div role="tablist" aria-label="Views" className="mx-auto mt-8 inline-flex rounded-full bg-white/10 p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn('h-9 rounded-full px-5 text-sm font-medium transition-colors', tab === t.id ? 'bg-gold-400 text-navy-900' : 'text-white/80 hover:text-white')}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mx-auto mt-10 max-w-[1080px]" role="tabpanel">
        {tab === 'sessions' && <MeetingMock />}
        {tab === 'conversations' && <img src="/tour-conversations.webp" alt="Conversations flowing through SYNAPSE" loading="lazy" className="w-full rounded-[28px]" />}
        {tab === 'pulse' && <img src="/tour-pulse.webp" alt="Team pulse dashboard in SYNAPSE" loading="lazy" className="w-full rounded-[28px]" />}
      </div>
    </section>
  );
}
