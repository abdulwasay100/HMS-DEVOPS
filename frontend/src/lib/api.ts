const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const TOKEN_KEY = "hms.token";

export interface FieldError {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details: FieldError[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Field-level messages keyed by field name, e.g. { check_out: "..." }. */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const d of this.details) {
      const key = d.path.split(".")[0];
      if (key && !out[key]) out[key] = d.message;
    }
    return out;
  }
}

export const tokenStore = {
  get: () => (typeof window === "undefined" ? null : window.localStorage.getItem(TOKEN_KEY)),
  set: (token: string) => window.localStorage.setItem(TOKEN_KEY, token),
  clear: () => window.localStorage.removeItem(TOKEN_KEY),
};

export const UNAUTHORIZED_EVENT = "hms:unauthorized";

type Query = Record<string, string | number | boolean | undefined | null>;

function buildUrl(path: string, query?: Query) {
  const url = new URL(`${API_URL}/api${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

export interface ApiResponse<T> {
  data: T;
  meta?: import("./types").PageMeta;
  // Some endpoints attach extra top-level fields (e.g. low_stock warnings).
  [key: string]: unknown;
}

async function request<T>(
  method: string,
  path: string,
  opts: { query?: Query; body?: unknown; auth?: boolean } = {},
): Promise<ApiResponse<T>> {
  const token = opts.auth === false ? null : tokenStore.get();
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      headers: {
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Cannot reach the server. Check your connection and try again.");
  }

  if (res.status === 204) return { data: undefined as T };

  let json: { error?: { message?: string; details?: FieldError[] } } & Partial<ApiResponse<T>> = {};
  try {
    json = await res.json();
  } catch {
    // non-JSON body
  }

  if (!res.ok) {
    if (res.status === 401 && opts.auth !== false && typeof window !== "undefined") {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    throw new ApiError(res.status, json.error?.message ?? `Request failed (${res.status})`, json.error?.details ?? []);
  }
  return json as ApiResponse<T>;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>("GET", path, { query }),
  post: <T>(path: string, body?: unknown, auth = true) => request<T>("POST", path, { body: body ?? {}, auth }),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, { body }),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, { body }),
  delete: (path: string) => request<void>("DELETE", path),
};

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong";
}
