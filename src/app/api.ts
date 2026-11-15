/** Call the Worker API with the browser session and surface its error message. */
export async function request<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    ...(data === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  });
  if (response.status === 204) return undefined as T;
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(result.error || 'The request failed. Please try again.');
  return result;
}

export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Please try again.';
