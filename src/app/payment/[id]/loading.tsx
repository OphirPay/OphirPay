import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className='space-y-6'>
      <Skeleton className='h-10 w-1/3' />
      <div className='space-y-4'>
        <Skeleton className='h-4 w-1/2' />
        <Skeleton className='h-4 w-1/3' />
        <Skeleton className='h-4 w-1/4' />
      </div>
      <div className='space-y-2'>
        <Skeleton className='h-8 w-full rounded-lg' />
        <Skeleton className='h-8 w-full rounded-lg' />
        <Skeleton className='h-8 w-full rounded-lg' />
      </div>
      <div className='space-y-2 mt-4'>
        <Skeleton className='h-3 w-1/4' />
        <Skeleton className='h-3 w-1/3' />
      </div>
    </div>
  );
}