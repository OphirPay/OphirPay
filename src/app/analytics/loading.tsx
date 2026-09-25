import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className='space-y-6'>
      <Skeleton className='h-10 w-1/3' />
      <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4'>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className='space-y-2'>
            <Skeleton className='h-24 w-full rounded-lg' />
            <Skeleton className='h-3 w-full' />
          </div>
        ))}
      </div>
    </div>
  );
}