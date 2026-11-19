/**
 * The message a list page shows when its main request fails, instead of an empty list (an empty
 * list would wrongly say there is nothing there). A server error (5xx) carries a requestId that
 * support can look up, so it is shown with the message.
 */
export async function loadErrorMessage(res: Response, what: string): Promise<string> {
  const body = await res.clone().json().catch(() => ({} as { error?: string; requestId?: string }));
  const reason = res.status >= 500 ? 'the server had a problem' : body?.error || `the server answered ${res.status}`;
  const ref = body?.requestId ? ` Reference: ${body.requestId}.` : '';
  return `Could not load ${what}: ${reason}. Try again in a moment.${ref}`;
}

export const NETWORK_ERROR = (what: string) => `Could not load ${what}: the server could not be reached. Check your connection and try again.`;
