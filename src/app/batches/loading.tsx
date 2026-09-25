import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className='space-y-4'>
      <Skeleton className='h-10 w-full' />
      <div className='space-y-2'>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className='flex items-center gap-4 p-4 border rounded-lg'>
            <Skeleton className='h-8 w-24 rounded' />
            <div className='flex-1 space-y-1'>
              <Skeleton className='h-3 w-1/3' />
              <Skeleton className='h-3 w-1/4' />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}