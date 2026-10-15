// Existing imports and code...

interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
}

export function formatProblemDetails({
  type,
  title,
  status,
  detail,
  instance,
}: ProblemDetails): Response {
  const problem = {
    type,
    title,
    status,
    ...(detail && { detail }),
    ...(instance && { instance }),
  };
  return new Response(JSON.stringify(problem), {
    headers: {
      "Content-Type": "application/problem+json",
    },
    status,
  });
}
