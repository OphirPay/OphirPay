// RFC 7807 - Problem Details for HTTP APIs
// Issue #1364 - OphirPay

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: Record<string, string[]>;
}

export function formatProblemDetails(params: {
  type?: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: Record<string, string[]>;
}): ProblemDetails {
  const { type, title, status, detail, instance, errors } = params;
  return {
    type: type?? `https://ophirpay.com/errors/${title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`,
    title,
    status,
    detail,
    instance,
   ...(errors && Object.keys(errors).length > 0? { errors } : {}),
  };
}

export function zodToProblemErrors(zodError: any): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  const issues = zodError?.issues?? zodError?.errors?? [];
  for (const issue of issues) {
    const path = Array.isArray(issue.path)? issue.path.join('.') : String(issue.path?? 'root');
    const key = path || 'root';
    if (!map[key]) map[key] = [];
    map[key].push(issue.message);
  }
  return map;
}