import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { HowellsLogo } from '@/components/layout/Sidebar';
import { Sparkles, Shield, Calendar, Users, ArrowLeft, CheckCircle2, ArrowRight, Play, Zap, Video, Globe2, Radio, ShieldCheck, UsersRound, MessageSquare, Activity, Search, Mic, MicOff, VideoOff, Phone, Hand, ScreenShare, MoreHorizontal, Lock, Eye, EyeOff } from 'lucide-react';

type Mode = 'signin' | 'signup' | 'forgot' | 'reset';

export function AuthPage() {
  const { signIn, signUp, resetPassword, updatePassword } = useAuth();
  const [mode, setMode] = useState<Mode>(() => {
    if (window.location.hash.includes('reset-password')) return 'reset';
    return 'signin';
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAuth, setShowAuth] = useState(() => window.location.hash.includes('reset-password'));
  const [tourTab, setTourTab] = useState<'sessions' | 'conversations' | 'pulse'>('sessions');
  const [speakingIndex, setSpeakingIndex] = useState(0);

  useEffect(() => {
    if (tourTab !== 'sessions') return;
    const speakers = [0, 2, 3, 5, 1, 4, 0, 3];
    let i = 0;
    const interval = setInterval(() => {
      setSpeakingIndex(speakers[i % speakers.length]);
      i++;
    }, 2400);
    return () => clearInterval(interval);
  }, [tourTab]);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setInfo(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);

    if (mode === 'signup') {
      const { error, needsConfirmation } = await signUp(email, password, firstName, lastName);
      if (error) {
        setError(error);
        setLoading(false);
      } else if (needsConfirmation) {
        setMode('signin');
        setPassword('');
        setInfo(`Almost done! We sent a confirmation link to ${email}. Click it, then sign in here.`);
        setLoading(false);
      }
    } else if (mode === 'signin') {
      const { error } = await signIn(email, password);
      if (error) {
        setError(error);
        setLoading(false);
      }
    } else if (mode === 'forgot') {
      const { error } = await resetPassword(email);
      if (error) {
        setError(error);
      } else {
        setInfo('Check your email for a password reset link.');
      }
      setLoading(false);
    } else if (mode === 'reset') {
      const { error } = await updatePassword(password);
      if (error) {
        setError(error);
        setLoading(false);
      } else {
        setInfo('Your password has been updated. You can now sign in.');
        setMode('signin');
        setLoading(false);
      }
    }
  };

  const showFormFields = mode === 'signin' || mode === 'signup' || mode === 'reset';
  const showNameFields = mode === 'signup';
  const showPasswordField = mode === 'signin' || mode === 'signup' || mode === 'reset';
  const showEmailField = mode !== 'reset';

  const titles: Record<Mode, string> = {
    signin: 'Welcome back',
    signup: 'Create your account',
    forgot: 'Reset your password',
    reset: 'Set a new password',
  };

  const subtitles: Record<Mode, string> = {
    signin: 'Sign in to your SYNAPSE workspace to continue.',
    signup: 'Start managing appointments in minutes.',
    forgot: 'Enter your email and we will send you a reset link.',
    reset: 'Choose a new password for your account.',
  };

  const buttonLabels: Record<Mode, string> = {
    signin: 'Sign In',
    signup: 'Create Account',
    forgot: 'Send Reset Link',
    reset: 'Update Password',
  };

  // ── Auth form (sign in / sign up / forgot / reset) ──
  if (showAuth) {
    return (
      <div className="min-h-screen flex">
        {/* Left brand panel */}
        <div className="hidden lg:flex lg:w-[45%] bg-navy-800 flex-col justify-between p-12 relative overflow-hidden">
          <div className="absolute inset-0 opacity-5">
            <div className="absolute top-20 left-20 w-72 h-72 rounded-full bg-gold-400 blur-3xl" />
            <div className="absolute bottom-20 right-20 w-96 h-96 rounded-full bg-navy-400 blur-3xl" />
          </div>

          <div className="relative">
            <button onClick={() => setShowAuth(false)} className="flex items-center gap-3 group">
              <div className="w-11 h-11 rounded-xl bg-navy-700 border border-navy-600 flex items-center justify-center transition group-hover:border-gold-400/40">
                <HowellsLogo className="w-6 h-6" />
              </div>
              <span className="text-2xl font-bold tracking-wide text-ivory-100">SYNAPSE</span>
            </button>
          </div>

          <div className="relative space-y-8">
            <div>
              <h1 className="text-3xl font-bold text-ivory-100 leading-tight text-balance">
                The complete appointment management operating system
              </h1>
              <p className="text-ivory-500 mt-4 text-lg leading-relaxed max-w-md">
                Schedule, automate, and manage every appointment with intelligent workflows and seamless calendar sync.
              </p>
            </div>

            <div className="space-y-4">
              <FeatureRow icon={Calendar} title="Smart scheduling with conflict detection" />
              <FeatureRow icon={Users} title="Built-in CRM with contact timelines" />
              <FeatureRow icon={Sparkles} title="AI-powered assistant and automation" />
              <FeatureRow icon={Shield} title="Secure, reliable, and production-ready" />
            </div>
          </div>

          <div className="relative text-ivory-600 text-sm">
            © 2026 SYNAPSE. All rights reserved.
          </div>
        </div>

        {/* Right form panel */}
        <div className="flex-1 flex items-center justify-center p-6 bg-white">
          <div className="w-full max-w-sm">
            {/* Mobile logo */}
            <div className="flex items-center gap-2.5 mb-8 lg:hidden">
              <div className="w-10 h-10 rounded-xl bg-navy-800 flex items-center justify-center">
                <HowellsLogo className="w-5 h-5" />
              </div>
              <span className="text-xl font-bold tracking-wide text-navy-800">SYNAPSE</span>
            </div>

            {mode === 'forgot' && (
              <button
                onClick={() => switchMode('signin')}
                className="flex items-center gap-1.5 text-sm text-ivory-600 hover:text-navy-700 transition-colors mb-4"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to sign in
              </button>
            )}

            <h2 className="text-2xl font-bold text-navy-800">{titles[mode]}</h2>
            <p className="text-ivory-600 mt-2 text-sm">{subtitles[mode]}</p>

            {info && (
              <div className="mt-4 bg-green-50 text-green-700 text-sm rounded-xl px-4 py-3 border border-green-100 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                {info}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
              {showNameFields && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-navy-700 mb-1.5">First name</label>
                    <input
                      type="text"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      required
                      className="input-field"
                      placeholder="John"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-navy-700 mb-1.5">Last name</label>
                    <input
                      type="text"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      required
                      className="input-field"
                      placeholder="Doe"
                    />
                  </div>
                </div>
              )}

              {showEmailField && (
                <div>
                  <label className="block text-sm font-medium text-navy-700 mb-1.5">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="input-field"
                    placeholder="you@company.com"
                  />
                </div>
              )}

              {showPasswordField && (
                <div>
                  <label className="block text-sm font-medium text-navy-700 mb-1.5">
                    {mode === 'reset' ? 'New Password' : 'Password'}
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required={showFormFields}
                      minLength={6}
                      className="input-field pr-11"
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-ivory-600 transition-colors hover:text-navy-700"
                    >
                      {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                    </button>
                  </div>
                </div>
              )}

              {mode === 'signin' && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => switchMode('forgot')}
                    className="text-sm text-gold-700 hover:text-gold-600 transition-colors font-medium"
                  >
                    Forgot password?
                  </button>
                </div>
              )}

              {error && (
                <div className="bg-red-50 text-red-700 text-sm rounded-xl px-4 py-3 border border-red-100">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-navy-800/30 border-t-navy-800 rounded-full animate-spin" />
                    Please wait...
                  </span>
                ) : (
                  buttonLabels[mode]
                )}
              </button>
            </form>

            {mode === 'signin' && (
              <p className="text-center text-sm text-ivory-600 mt-6">
                Don't have an account?{' '}
                <button
                  onClick={() => switchMode('signup')}
                  className="font-semibold text-gold-700 hover:text-gold-600 transition-colors"
                >
                  Sign up
                </button>
              </p>
            )}

            {mode === 'signup' && (
              <p className="text-center text-sm text-ivory-600 mt-6">
                Already have an account?{' '}
                <button
                  onClick={() => switchMode('signin')}
                  className="font-semibold text-gold-700 hover:text-gold-600 transition-colors"
                >
                  Sign in
                </button>
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Landing page ──
  const openSignIn = () => { setShowAuth(true); switchMode('signin'); };
  const openSignUp = () => { setShowAuth(true); switchMode('signup'); };

  return (
    <div className="landing-page min-h-screen overflow-hidden bg-[#09132b] text-white">
      <div className="landing-grid absolute inset-0 pointer-events-none" />
      <div className="landing-glow absolute inset-0 pointer-events-none" />

      <nav className="relative z-10 flex items-center justify-between px-6 py-5 sm:px-10 sm:py-6 lg:px-14">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#E4A93C] shadow-[0_0_22px_rgba(228,169,60,0.35)]">
            <HowellsLogo className="h-6 w-6" />
          </div>
          <span className="text-[17px] font-bold tracking-[-0.02em] text-white">SYNAPSE</span>
        </div>
        <button
          onClick={openSignIn}
          className="flex items-center gap-2 rounded-xl border border-[#5a4a1e] bg-[#1a160c]/80 px-5 py-2.5 text-[13px] font-semibold text-white transition hover:border-[#E4A93C] hover:bg-[#241d0f]"
        >
          <ArrowRight className="h-4 w-4" />
          Sign In
        </button>
      </nav>

      <main className="relative z-10 mx-auto max-w-[1280px] px-5 pb-20 pt-20 text-center sm:pt-24 lg:px-8 lg:pt-28">
        <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-[#6b521e] bg-[#1a160c]/70 px-5 py-2 text-[13px] font-medium text-[#E4A93C]">
          <Zap className="h-4 w-4" />
          The Future of Human Collaboration
        </div>

        <h1 className="mx-auto mt-7 max-w-[820px] text-[48px] font-bold leading-[1.04] tracking-[-0.055em] text-white sm:text-[64px] lg:text-[76px]">
          Your Digital <span className="text-[#E4A93C]">Universe</span><br />for Collaboration
        </h1>
        <p className="mx-auto mt-6 max-w-[620px] text-[16px] leading-[1.6] text-[#91a5c9] sm:text-[18px]">
          Meetings that feel alive. Workspaces that persist. AI that understands.<br className="hidden sm:block" /> SYNAPSE merges video, AI, spatial interaction, and collaboration into one immersive ecosystem.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button onClick={openSignUp} className="flex items-center gap-2 rounded-xl bg-[#E4A93C] px-6 py-3.5 text-[14px] font-semibold text-[#1a160c] shadow-[0_5px_22px_rgba(228,169,60,0.24)] transition hover:bg-[#F0B855] active:scale-[0.98]">
            <ArrowRight className="h-4 w-4" />
            Get Started Free
          </button>
          <button onClick={openSignIn} className="flex items-center gap-2 rounded-xl border border-[#3a2f15] bg-[#0f2043]/70 px-6 py-3.5 text-[14px] font-semibold text-[#c9b889] transition hover:border-[#E4A93C] hover:text-white">
            <Play className="h-4 w-4" />
            Watch Demo
          </button>
        </div>

        <div className="mx-auto mt-10 grid max-w-[720px] grid-cols-3 divide-x divide-[#2a2310]">
          <LandingStat value="10x" label="Faster Decisions" />
          <LandingStat value="300%" label="Team Engagement" />
          <LandingStat value="Zero" label="Meeting Fatigue" />
        </div>

        {/* Product tour — Create your space */}
        <section className="mt-24">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-[#6b521e] bg-[#1a160c]/70 px-4 py-1.5 text-[12px] font-medium text-[#E4A93C]">
            <Globe2 className="h-3.5 w-3.5" />
            Create your space
          </div>
          <h2 className="mt-5 text-[30px] font-bold tracking-[-0.035em] text-white sm:text-[36px]">One space. Three ways to flow.</h2>
          <p className="mx-auto mt-4 max-w-[580px] text-[16px] leading-relaxed text-[#91a5c9]">Launch a SYNAPSE space in seconds. Run a focus session, keep conversations alive, and watch your team&apos;s pulse — all without leaving the room.</p>

          {/* Tabs */}
          <div className="mt-6 flex items-center justify-center gap-2">
            <TourTab active={tourTab === 'sessions'} onClick={() => setTourTab('sessions')} icon={Video} label="Sessions" />
            <TourTab active={tourTab === 'conversations'} onClick={() => setTourTab('conversations')} icon={MessageSquare} label="Conversations" />
            <TourTab active={tourTab === 'pulse'} onClick={() => setTourTab('pulse')} icon={Activity} label="Pulse" />
          </div>

          {/* Visual */}
          <div className="mx-auto mt-5 w-full max-w-[1180px] overflow-hidden rounded-3xl border border-[#2a2310] bg-[#0c1830] shadow-[0_36px_110px_rgba(0,0,0,0.38)]">
            {tourTab !== 'sessions' && (
              <div className="flex items-center gap-2 border-b border-[#1a2a4a] bg-[#0a1528] px-4 py-3">
                <span className="h-3 w-3 rounded-full bg-[#e0655b]" />
                <span className="h-3 w-3 rounded-full bg-[#e4a93c]" />
                <span className="h-3 w-3 rounded-full bg-[#4ec26a]" />
                <div className="ml-3 flex items-center gap-2 text-[12px] text-[#6b7fa5]">
                  <Search className="h-3.5 w-3.5" />
                  synapse.app / {tourTab}
                </div>
              </div>
            )}

            <div className="relative">
              {tourTab === 'sessions' && (
                <div className="bg-[#0a1018]">
                  {/* Meeting top bar */}
                  <div className="flex items-center justify-between px-5 py-3.5 bg-[#0d1420] border-b border-[#1a2333]">
                    <div className="flex items-center gap-2">
                      <Lock className="h-3.5 w-3.5 text-[#4ec26a]" />
                      <span className="text-[12px] font-medium text-white">Q3 Strategy Review</span>
                      <span className="text-[11px] text-[#5a6a85]">· 6 members</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-[#e0655b] animate-pulse" />
                      <span className="text-[11px] font-medium text-[#e0655b]">REC</span>
                      <span className="ml-2 text-[11px] text-[#5a6a85] tabular-nums">24:18</span>
                    </div>
                  </div>

                  {/* Participant grid */}
                  <div className="grid grid-cols-3 gap-2 p-2">
                    {[
                      { img: '/p1.webp', name: 'Sofia Reyes', muted: false, hand: false },
                      { img: '/p2.webp', name: 'Arjun Patel', muted: true, hand: false },
                      { img: '/p3.webp', name: 'Maya Johnson', muted: false, hand: true },
                      { img: '/p4.webp', name: 'Liam Murphy', muted: false, hand: false },
                      { img: '/p5.webp', name: 'Yuki Tanaka', muted: true, hand: false },
                      { img: '/p6.webp', name: 'Karim Hassan', muted: false, hand: false },
                    ].map((p, idx) => {
                      const isSpeaking = idx === speakingIndex && !p.muted;
                      return (
                        <div key={p.name} className={`relative aspect-[4/3] overflow-hidden rounded-lg bg-[#111824] transition-all duration-300 ${isSpeaking ? 'speaking-ring' : 'ring-1 ring-white/5'}`}>
                          <img src={p.img} alt={p.name} className={`live-tile-img h-full w-full object-cover ${isSpeaking ? 'opacity-100' : 'opacity-80'}`} style={{ animationDelay: `${idx * 2.5}s` }} />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                          {/* Name label */}
                          <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1.5 rounded-md bg-black/50 px-1.5 py-1 backdrop-blur-sm">
                            {p.muted ? <MicOff className="h-3 w-3 text-[#e0655b]" /> : <Mic className={`h-3 w-3 ${isSpeaking ? 'text-[#E4A93C]' : 'text-[#c9d5e8]'}`} />}
                            <span className="text-[10px] font-medium text-white">{p.name}</span>
                          </div>
                          {/* Hand raise indicator */}
                          {p.hand && (
                            <div className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-[#E4A93C]">
                              <Hand className="h-3.5 w-3.5 text-[#1a160c]" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Control bar */}
                  <div className="flex items-center justify-center gap-2.5 px-5 py-4 bg-[#0d1420] border-t border-[#1a2333]">
                    <button className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#1a2333] text-[#c9d5e8] transition hover:bg-[#243049]">
                      <Mic className="h-4 w-4" />
                    </button>
                    <button className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#1a2333] text-[#c9d5e8] transition hover:bg-[#243049]">
                      <Video className="h-4 w-4" />
                    </button>
                    <button className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#1a2333] text-[#c9d5e8] transition hover:bg-[#243049]">
                      <ScreenShare className="h-4 w-4" />
                    </button>
                    <button className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#1a2333] text-[#c9d5e8] transition hover:bg-[#243049]">
                      <Hand className="h-4 w-4" />
                    </button>
                    <button className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#1a2333] text-[#c9d5e8] transition hover:bg-[#243049]">
                      <MessageSquare className="h-4 w-4" />
                    </button>
                    <button className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#1a2333] text-[#c9d5e8] transition hover:bg-[#243049]">
                      <Users className="h-4 w-4" />
                    </button>
                    <button className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#1a2333] text-[#c9d5e8] transition hover:bg-[#243049]">
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                    <div className="mx-1 h-6 w-px bg-[#1a2333]" />
                    <button className="flex h-9 items-center gap-2 rounded-lg bg-[#e0655b] px-3.5 text-[12px] font-semibold text-white transition hover:bg-[#d45048]">
                      <Phone className="h-4 w-4" />
                      Leave
                    </button>
                  </div>
                </div>
              )}
              {tourTab === 'conversations' && <img src="/tour-conversations.webp" alt="Conversations flowing through SYNAPSE" className="w-full" />}
              {tourTab === 'pulse' && <img src="/tour-pulse.webp" alt="Team pulse dashboard in SYNAPSE" className="w-full" />}
              {tourTab !== 'sessions' && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[#0c1830] to-transparent" />}
              <div className={`${tourTab === 'sessions' ? 'mt-3' : 'absolute bottom-4 left-5 right-5'} flex items-end justify-between gap-4`}>
                <div className="text-left">
                  <p className="text-[18px] font-bold text-white">
                    {tourTab === 'sessions' && 'Focus sessions that feel like the same room'}
                    {tourTab === 'conversations' && 'Conversations that never lose context'}
                    {tourTab === 'pulse' && 'A pulse on everything happening'}
                  </p>
                  <p className="mt-1 text-[13px] text-[#91a5c9]">
                    {tourTab === 'sessions' && 'Drop into a focus room with HD video and AI-captured action items.'}
                    {tourTab === 'conversations' && 'Threaded conversations that persist alongside your work.'}
                    {tourTab === 'pulse' && 'A live feed of sessions, tasks, and signals across your space.'}
                  </p>
                </div>
                <button onClick={openSignUp} className="hidden shrink-0 items-center gap-2 rounded-xl bg-[#E4A93C] px-5 py-2.5 text-[13px] font-semibold text-[#1a160c] transition hover:bg-[#F0B855] sm:flex">
                  Try it
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Quick feature grid */}
        <section className="mt-24">
          <h2 className="text-[32px] font-bold tracking-[-0.035em] text-white sm:text-[40px]">Everything you need, nothing you don&apos;t</h2>
          <p className="mx-auto mt-4 max-w-[560px] text-[16px] leading-relaxed text-[#91a5c9]">Six powerful modules that replace a dozen disconnected tools — all in one elegant platform.</p>
          <div className="mt-8 grid grid-cols-1 gap-4 text-left sm:grid-cols-2 lg:grid-cols-3">
            <LandingFeature icon={Video} title="Live Meetings" desc="WebRTC-powered HD video with AI-generated summaries and action items." />
            <LandingFeature icon={Sparkles} title="AI Intelligence" desc="Real-time transcription, sentiment analysis, and automatic action extraction." />
            <LandingFeature icon={Globe2} title="Spatial Workspaces" desc="Move freely in immersive digital environments built for deep work." />
            <LandingFeature icon={UsersRound} title="Team Channels" desc="Persistent collaborative spaces that never sleep, with full conversation history." />
            <LandingFeature icon={Radio} title="Live Webinars" desc="Host events for thousands of attendees with full engagement analytics." />
            <LandingFeature icon={ShieldCheck} title="Secure by Default" desc="End-to-end encrypted communication with row-level database security." />
          </div>
        </section>

        {/* Detailed features inside SYNAPSE */}
        <section className="mt-24">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-[#6b521e] bg-[#1a160c]/70 px-4 py-1.5 text-[12px] font-medium text-[#E4A93C]">
            <Sparkles className="h-3.5 w-3.5" />
            Inside SYNAPSE
          </div>
          <h2 className="mt-5 text-[30px] font-bold tracking-[-0.035em] text-white sm:text-[36px]">A complete operating system for your work</h2>
          <p className="mx-auto mt-4 max-w-[600px] text-[16px] leading-relaxed text-[#91a5c9]">From scheduling to automation, every feature is designed to work together seamlessly — so your team spends less time switching tools and more time doing real work.</p>

          <div className="mt-10 grid grid-cols-1 gap-5 text-left lg:grid-cols-2">
            <DetailedFeature
              icon={Calendar}
              title="Smart Scheduling Engine"
              desc="Conflict detection, group bookings, round-robin assignment, and buffer rules. Connect your calendars and let SYNAPSE find the perfect time automatically."
              points={['Group & round-robin bookings', 'Real-time conflict detection', 'Calendar sync with Google & Outlook', 'Custom buffers and availability rules']}
            />
            <DetailedFeature
              icon={Users}
              title="Built-in CRM"
              desc="Every contact, conversation, and appointment in one timeline. See the full history of your relationships at a glance and never lose context again."
              points={['Contact timelines & history', 'Conversation tracking', 'Custom fields and tags', 'Smart search across everything']}
            />
            <DetailedFeature
              icon={Sparkles}
              title="AI Assistant & Automation"
              desc="Summarize meetings, extract action items, draft follow-ups, and trigger workflows — all powered by AI that understands the context of your work."
              points={['Meeting summaries & transcripts', 'Automatic action-item extraction', 'Follow-up email drafting', 'Visual workflow builder']}
            />
            <DetailedFeature
              icon={ShieldCheck}
              title="Enterprise-grade Security"
              desc="Row-level database security, end-to-end encryption, and granular access controls. Your data is protected at every layer by default."
              points={['Row-level security policies', 'End-to-end encryption', 'Role-based access control', 'Audit logs and compliance ready']}
            />
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto mt-24 max-w-[640px] rounded-3xl border border-[#5a4a1e] bg-gradient-to-b from-[#1a160c]/80 to-[#120f08]/80 px-8 py-12 shadow-[0_30px_100px_rgba(0,0,0,0.22)] sm:px-14">
          <Zap className="mx-auto h-9 w-9 text-[#E4A93C]" />
          <h2 className="mt-4 text-[30px] font-bold tracking-[-0.03em] text-white sm:text-[36px]">Ready to enter the future?</h2>
          <p className="mx-auto mt-4 max-w-[420px] text-[16px] leading-relaxed text-[#91a5c9]">Join teams building the next generation of remote work with SYNAPSE. Free to start, no credit card required.</p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <button onClick={openSignUp} className="flex items-center gap-2 rounded-xl bg-[#E4A93C] px-6 py-3.5 text-[14px] font-semibold text-[#1a160c] transition hover:bg-[#F0B855] active:scale-[0.98]">
              <ArrowRight className="h-4 w-4" />
              Get Started Free
            </button>
            <button onClick={openSignIn} className="flex items-center gap-2 rounded-xl border border-[#3a2f15] bg-[#0f2043]/70 px-6 py-3.5 text-[14px] font-semibold text-[#c9b889] transition hover:border-[#E4A93C] hover:text-white">
              Sign In
            </button>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-[#2a2310] bg-[#0b1306]/80 px-6 py-8 text-center">
        <div className="flex items-center justify-center gap-2 text-[13px] font-semibold text-white"><Zap className="h-4 w-4 text-[#E4A93C]" /> SYNAPSE</div>
        <p className="mt-2 text-[13px] text-[#7085aa]">© 2026 SYNAPSE. The Future of Human Collaboration.</p>
      </footer>
    </div>
  );
}

function FeatureRow({ icon: Icon, title }: { icon: typeof Calendar; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-xl bg-navy-700 border border-navy-600 flex items-center justify-center shrink-0">
        <Icon className="w-[18px] h-[18px] text-gold-400" />
      </div>
      <span className="text-ivory-200 text-sm font-medium">{title}</span>
    </div>
  );
}

function LandingStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="px-6 sm:px-8">
      <p className="text-[36px] font-bold leading-none tracking-[-0.04em] text-[#E4A93C] sm:text-[42px]">{value}</p>
      <p className="mt-2.5 text-[13px] font-medium text-[#8da1c5] sm:text-[14px]">{label}</p>
    </div>
  );
}

function LandingFeature({ icon: Icon, title, desc }: { icon: typeof Calendar; title: string; desc: string }) {
  return (
    <div className="rounded-2xl border border-[#2a2310] bg-[#0e1a35]/80 p-6 text-left transition hover:border-[#E4A93C]/40 hover:bg-[#112348]">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#5a4a1e] bg-[#1a160c]/60">
        <Icon className="h-6 w-6 text-[#E4A93C]" />
      </div>
      <h3 className="mt-5 text-[18px] font-bold text-white">{title}</h3>
      <p className="mt-2 text-[14px] leading-[1.55] text-[#8196bb]">{desc}</p>
    </div>
  );
}

function DetailedFeature({ icon: Icon, title, desc, points }: { icon: typeof Calendar; title: string; desc: string; points: string[] }) {
  return (
    <div className="rounded-2xl border border-[#2a2310] bg-[#0e1a35]/80 p-7 transition hover:border-[#E4A93C]/30">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#5a4a1e] bg-[#1a160c]/60">
        <Icon className="h-7 w-7 text-[#E4A93C]" />
      </div>
      <h3 className="mt-5 text-[22px] font-bold tracking-[-0.02em] text-white">{title}</h3>
      <p className="mt-3 text-[15px] leading-[1.6] text-[#8196bb]">{desc}</p>
      <ul className="mt-5 space-y-2.5">
        {points.map((p) => (
          <li key={p} className="flex items-center gap-2.5 text-[14px] text-[#c9b889]">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-[#E4A93C]" />
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TourTab({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof Calendar; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-[14px] font-semibold transition ${active ? 'bg-[#E4A93C] text-[#1a160c]' : 'border border-[#2a2310] bg-[#0e1a35]/80 text-[#8196bb] hover:border-[#E4A93C]/40 hover:text-white'}`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}
