// Session credentials stay in this module's memory and disappear on reload/logout.
let csrfToken = "";
export const setCsrf = (value: string) => {
  csrfToken = value;
};
export async function api(path: string, body?: unknown, method?: string) {
  const verb = method ?? (body !== undefined ? "POST" : "GET");
  const response = await fetch("/api" + path, {
    method: verb,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(verb !== "GET" && csrfToken ? { "X-AB-CSRF": csrfToken } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const value = await response
    .json()
    .catch(() => ({ error: "Control API returned an unreadable response" }));
  if (response.status === 401 && typeof window !== "undefined") window.dispatchEvent(new Event("agentbrake:unauthorized"));
  if (!response.ok)
    throw Object.assign(new Error(value.error || "Request failed"), {
      status: response.status,
    });
  return value;
}
