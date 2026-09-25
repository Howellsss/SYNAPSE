import { type ReactNode, useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  width?: 'md' | 'lg' | 'xl';
  footer?: ReactNode;
  overlay?: boolean;
}

const widthClasses = {
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
};

export function Drawer({ open, onClose, title, description, children, width = 'lg', footer, overlay = true }: DrawerProps) {
  useEffect(() => {
    if (open && overlay) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [open, overlay]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (open) window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={cn('inset-0 z-[85] flex justify-end', overlay ? 'fixed' : 'absolute')}>
      {overlay && <div className="absolute inset-0 bg-navy-900/30 animate-backdrop-in" onClick={onClose} />}
      <div
        className={cn(
          'relative bg-white h-full w-full animate-drawer-in shadow-drawer flex flex-col',
          widthClasses[width]
        )}
      >
        {(title || description) && (
          <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-navy-100 shrink-0">
            <div className="min-w-0">
              {title && <h2 className="text-lg font-semibold text-navy-800 truncate">{title}</h2>}
              {description && <p className="text-sm text-ivory-600 mt-1">{description}</p>}
            </div>
            <button
              onClick={onClose}
              className="text-ivory-600 hover:text-navy-700 transition-colors p-1 -mr-1 -mt-1 shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-navy-100 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
