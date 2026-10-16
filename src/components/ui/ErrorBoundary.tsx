import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, ArrowLeft, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  children: ReactNode;
  /** What failed, for the heading ("this workspace", "this page"). */
  what: string;
  /** Leave for somewhere that works (the button is hidden without it). */
  onBack?: () => void;
  backLabel?: string;
  /** Fill the screen (navy, under a workspace) instead of sitting in the page. */
  dark?: boolean;
  /** Changing this clears the error (e.g. the page you're on). */
  resetKey?: string;
}

interface State { error: Error | null }

/**
 * Catches a crash in what it wraps, so the rest of SYNAPSE keeps working: shows what went wrong
 * (with the error, to send us) and a way back, instead of a blank white screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[SYNAPSE] ${this.props.what} crashed:`, error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { what, onBack, backLabel = 'Back to SYNAPSE', dark } = this.props;
    return (
      <div className={cn('flex w-full items-center justify-center p-4', dark ? 'h-full bg-navy-900' : 'min-h-[60vh]')}>
        <div role="alert" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-popover ring-1 ring-navy-100">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-gold-100 text-gold-700">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          </div>
          <h2 className="text-lg font-semibold text-navy-900">Something went wrong opening {what}</h2>
          <p className="mt-1 text-sm text-navy-600">The rest of SYNAPSE still works. Try again, or go back. If it keeps happening, send us the message below.</p>
          <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-navy-50 p-3 text-xs text-navy-800 select-all">{error.message || String(error)}</pre>
          <div className="mt-4 flex flex-wrap gap-2">
            {onBack && (
              <button type="button" onClick={() => { this.setState({ error: null }); onBack(); }}
                className="inline-flex items-center gap-2 rounded-xl bg-navy-800 px-4 py-2 text-sm font-semibold text-white hover:bg-navy-700">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {backLabel}
              </button>
            )}
            <button type="button" onClick={() => this.setState({ error: null })}
              className="inline-flex items-center gap-2 rounded-xl bg-gold-400 px-4 py-2 text-sm font-semibold text-navy-900 hover:bg-gold-300">
              <RotateCcw className="h-4 w-4" aria-hidden="true" /> Try again
            </button>
          </div>
        </div>
      </div>
    );
  }
}
