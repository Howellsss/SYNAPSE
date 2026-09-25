import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-navy-900/40 animate-backdrop-in" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-popover w-full max-w-md animate-scale-in p-6">
        <h2 className="text-lg font-semibold text-navy-800 mb-2">{title}</h2>
        <p className="text-sm text-ivory-600 mb-6">{message}</p>
        <div className="flex items-center justify-end gap-3">
          <button onClick={onClose} className="btn-secondary">
            {cancelLabel}
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className={danger ? 'btn-danger' : 'btn-primary'}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

interface BadgeProps {
  children: ReactNode;
  variant?: 'default' | 'gold' | 'navy';
  className?: string;
}

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  const variants = {
    default: 'bg-ivory-100 text-ivory-700',
    gold: 'bg-gold-50 text-gold-700',
    navy: 'bg-navy-800 text-ivory-100',
  };
  return (
    <span className={cn('inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-md', variants[variant], className)}>
      {children}
    </span>
  );
}
