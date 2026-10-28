import { type LucideIcon } from 'lucide-react';
import { EmptyState } from '@/components/ui/States';

interface ComingSoonPageProps {
  title: string;
  description: string;
  icon: LucideIcon;
}

export function ComingSoonPage({ title, description, icon: Icon }: ComingSoonPageProps) {
  return (
    <div className="page space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-navy-800">{title}</h1>
        <p className="text-sm text-ivory-600 mt-0.5">{description}</p>
      </div>
      <div className="card page-fill justify-center">
        <EmptyState
          icon={<Icon className="w-7 h-7" />}
          title="Coming soon"
          description="This feature is under active development and will be available in a future release."
        />
      </div>
    </div>
  );
}
