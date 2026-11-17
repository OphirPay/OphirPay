import { NextResponse } from 'next/server';
import { batchSchema } from '@/lib/validation/batch';
import { ZodError } from 'zod';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    
    // Validate request body against schema
    const validatedData = batchSchema.parse(body);

    // Logic for processing the batch payment would go here
    // ...

    return NextResponse.json({ success: true, data: validatedData }, { status: 201 });

  } catch (error) {
    if (error instanceof ZodError) {
      // RFC 7807 Error Format
      return NextResponse.json(
        {
          type: "https://docs.ophirpay.com/errors/validation-error",
          title: "Bad Request",
          status: 400,
          detail: error.errors[0].message,
          instance: req.url,
          errors: error.errors.map(err => ({
            path: err.path.join('.'),
            message: err.message
          }))
        },
        { 
          status: 400,
          headers: { 'Content-Type': 'application/problem+json' }
        }
      );
    }

    // Handle generic errors
    return NextResponse.json(
      {
        type: "https://docs.ophirpay.com/errors/internal-server-error",
        title: "Internal Server Error",
        status: 500,
        detail: "An unexpected error occurred while processing the batch.",
        instance: req.url
      },
      { 
        status: 500,
        headers: { 'Content-Type': 'application/problem+json' }
      }
    );
  }
}
