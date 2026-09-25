"use client";

import { motion } from 'framer-motion';
import { Skeleton } from './ui/skeleton';

export function LoadingSkeleton({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className='animate-pulse'
    >
      {children}
    </motion.div>
  );
}

export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className='space-y-2'>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className='flex items-center gap-4 p-4 border rounded-lg'>
          <Skeleton className='h-8 w-24 rounded' />
          {Array.from({ length: columns }).map((_, j) => (
            <div key={j} className='flex-1 space-y-1'>
              <Skeleton className='h-3 w-full' />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4'>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className='space-y-2'>
          <Skeleton className='h-24 w-full rounded-lg' />
          <Skeleton className='h-3 w-full' />
          <Skeleton className='h-3 w-1/2' />
        </div>
      ))}
    </div>
  );
}