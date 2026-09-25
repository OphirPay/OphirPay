import { OfflineBanner } from '@/components/OfflineBanner';
import { AppShell } from '@/components/AppShell';

export function OfflinePage() {
  return (
    <AppShell>
      <div className="flex flex-col items-center justify-center h-screen gap-6">
        <OfflineBanner />
        <p className="text-center text-lg text-gray-500">
          You're currently offline. Some features may be unavailable.
        </p>
      </div>
    </AppShell>
  );
}