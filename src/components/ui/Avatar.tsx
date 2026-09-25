import { getInitials } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface AvatarProps {
  firstName?: string | null;
  lastName?: string | null;
  src?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const sizeClasses = {
  sm: 'w-7 h-7 text-xs',
  md: 'w-9 h-9 text-sm',
  lg: 'w-12 h-12 text-base',
  xl: 'w-16 h-16 text-xl',
};

export function Avatar({ firstName, lastName, src, size = 'md', className }: AvatarProps) {
  if (src) {
    return (
      <img
        src={src}
        alt={getInitials(firstName, lastName)}
        className={cn('rounded-full object-cover', sizeClasses[size], className)}
      />
    );
  }
  return (
    <div
      className={cn(
        'rounded-full flex items-center justify-center font-semibold text-navy-800 bg-gradient-to-br from-gold-200 to-gold-400 shrink-0',
        sizeClasses[size],
        className
      )}
    >
      {getInitials(firstName, lastName)}
    </div>
  );
}
