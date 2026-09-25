import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface ToastContextValue {
  toast: (message: string, type?: Toast['type']) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, type: Toast['type'] = 'success') => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const dismiss = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="animate-toast-in flex items-center gap-3 bg-white rounded-xl border border-navy-100 shadow-popover px-4 py-3 min-w-[280px] max-w-[400px] pointer-events-auto"
          >
            {t.type === 'success' && <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />}
            {t.type === 'error' && <AlertCircle className="w-5 h-5 text-burgundy-600 shrink-0" />}
            {t.type === 'info' && <Info className="w-5 h-5 text-blue-600 shrink-0" />}
            <p className="text-sm text-navy-700 font-medium flex-1">{t.message}</p>
            <button
              onClick={() => dismiss(t.id)}
              className="text-ivory-600 hover:text-navy-700 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
