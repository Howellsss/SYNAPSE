import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center py-16 px-6', className)}>
      <div className="w-14 h-14 rounded-2xl bg-ivory-100 flex items-center justify-center text-ivory-600 mb-4">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-navy-800 mb-1">{title}</h3>
      {description && <p className="text-sm text-ivory-600 max-w-sm mb-5">{description}</p>}
      {action}
    </div>
  );
}

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return <div className={cn('animate-pulse bg-ivory-100 rounded-lg', className)} />;
}

export function LoadingSpinner({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center justify-center', className)}>
      <div className="w-6 h-6 border-2 border-ivory-200 border-t-gold-400 rounded-full animate-spin" />
    </div>
  );
}

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center text-red-500 mb-4">
        <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-navy-800 mb-1">Something went wrong</h3>
      <p className="text-sm text-ivory-600 max-w-sm mb-5">
        {message || "We couldn't load this content. Please try again."}
      </p>
      {onRetry && (
        <button onClick={onRetry} className="btn-secondary">
          Try again
        </button>
      )}
    </div>
  );
}
