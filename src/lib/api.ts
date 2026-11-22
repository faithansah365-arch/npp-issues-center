export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    isFormData?: boolean;
  } = {},
): Promise<T> {
  const method = options.method || 'GET';
  const headers: Record<string, string> = {
    'X-Requested-With': 'NPP-Portal',
  };

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    if (options.isFormData && options.body instanceof FormData) {
      body = options.body;
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
  }

  const res = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body,
  });

  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  if (text) {
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = { error: text };
    }
  }

  if (!res.ok) {
    const msg =
      typeof parsed.error === 'string'
        ? parsed.error
        : `Request failed with status ${res.status}`;
    throw new ApiError(msg, res.status);
  }

  return parsed as T;
}
