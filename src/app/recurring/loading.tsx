import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className='space-y-4'>
      <Skeleton className='h-10 w-full' />
      <div className='space-y-2'>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className='flex items-center gap-4 p-4 border rounded-lg'>
            <Skeleton className='h-10 w-10 rounded-full' />
            <div className='flex-1 space-y-1'>
              <Skeleton className='h-3 w-1/2' />
              <Skeleton className='h-3 w-1/3' />
              <div className='flex gap-2 mt-2'>
                <Skeleton className='h-6 w-16 rounded' />
                <Skeleton className='h-6 w-16 rounded' />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}