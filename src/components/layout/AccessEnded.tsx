import { LogOut, ShieldOff } from 'lucide-react';

/** Shown instead of the app when an admin has suspended or removed the signed-in person. */
export function AccessEnded({ reason, workspaceName, onSignOut }: {
  reason: 'suspended' | 'removed';
  workspaceName: string | null;
  onSignOut: () => void;
}) {
  const where = workspaceName ? ` to ${workspaceName}` : '';
  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4">
      <div role="alert" className="card w-full max-w-md p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-navy-50">
          <ShieldOff className="h-6 w-6 text-navy-700" />
        </div>
        <h1 className="text-xl font-semibold text-navy-800">
          {reason === 'suspended' ? `Your access${where} is suspended` : `You’ve been removed${workspaceName ? ` from ${workspaceName}` : ''}`}
        </h1>
        <p className="mt-2 text-sm text-ivory-600">
          {reason === 'suspended'
            ? 'An admin has paused your account. Ask them to reactivate you.'
            : 'An admin has removed you from this account. If that’s a mistake, ask them to invite you again.'}
        </p>
        <button onClick={onSignOut} className="btn-primary mt-6 w-full justify-center">
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>
    </div>
  );
}
