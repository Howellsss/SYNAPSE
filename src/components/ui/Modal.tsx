import { type ReactNode, useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  footer?: ReactNode;
}

const sizeClasses = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

export function Modal({ open, onClose, title, description, children, size = 'md', footer }: ModalProps) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [open]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (open) window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-navy-900/40 animate-backdrop-in"
        onClick={onClose}
      />
      <div
        className={cn(
          'relative bg-white rounded-2xl shadow-popover w-full animate-scale-in flex flex-col max-h-[90vh]',
          sizeClasses[size]
        )}
      >
        {(title || description) && (
          <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-navy-100">
            <div>
              {title && <h2 className="text-lg font-semibold text-navy-800">{title}</h2>}
              {description && <p className="text-sm text-ivory-600 mt-1">{description}</p>}
            </div>
            <button
              onClick={onClose}
              className="text-ivory-600 hover:text-navy-700 transition-colors p-1 -mr-1 -mt-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}
        <div className="px-6 py-5 overflow-y-auto flex-1">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-navy-100">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
