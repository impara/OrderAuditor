import { QueryClient, QueryFunction } from "@tanstack/react-query";

// Declare the global shopify object
declare global {
  interface Window {
    shopify: any;
  }
}

// Helper to get fresh session token using App Bridge v4
async function getAuthToken(): Promise<string> {
  // DEVELOPMENT BYPASS
  if (import.meta.env.DEV && !window.location.search.includes("host")) {
    console.log("[Auth] 🛡️ Using DEV BYPASS token");
    return "dev-token";
  }

  try {
    // App Bridge v4 exposes the shopify global
    if (window.shopify && window.shopify.idToken) {
      console.log("[Auth] Fetching fresh session token from App Bridge v4...");
      const token = await window.shopify.idToken();
      console.log(
        "[Auth] Got fresh token from App Bridge, length:",
        token?.length
      );
      // Validate token is a string to maintain type contract
      if (typeof token === "string" && token?.length > 0) {
        return token;
      } else {
        console.warn(
          "[Auth] Invalid token received from App Bridge (not a string or empty)"
        );
        return "";
      }
    } else {
      console.warn(
        "[Auth] window.shopify not available. Are you running in the Shopify Admin?"
      );
      // Fallback or retry logic could go here, but usually if script is loaded it should be there
      return "";
    }
  } catch (error) {
    console.error("[Auth] Failed to get session token:", error);
    return "";
  }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    // Clone the response before reading it
    const clonedRes = res.clone();
    let errorText = res.statusText;

    if (res.status === 401) {
      console.warn(
        "[Auth] 401 Unauthorized received. Attempting to handle re-auth..."
      );
      try {
        const data = await clonedRes.json();
        if (data.retryAuth && data.shop) {
          console.log(`[Auth] Redirecting to auth for shop: ${data.shop}`);

          // Use App Bridge v4 to redirect
          // We can use window.open or just let the backend handle the redirect flow if we navigate top level
          // But since we are in an iframe, we need to break out.
          // App Bridge v4 handles standard links automatically if they target the admin.
          // For OAuth, we usually want to redirect the main window.

          // Construct the auth URL
          const authUrl = `${window.location.origin}/api/auth?shop=${data.shop}`;

          // In v4, we can use open to navigate
          if (window.shopify && window.shopify.open) {
            // Use remote target to break out of iframe if needed, or just navigate
            // For OAuth, we typically want to redirect the top frame.
            // window.shopify.open(authUrl, '_top') might be the way, currently 'open' is generic.
            // But actually, for OAuth, we often just set window.location.href and let App Bridge intercept if it's a same-origin navigation,
            // or use the 'open' action.

            // Let's try standard window.top.location if allowed, or use the API.
            // The safest bet for v4 is using the `open` API if available, or just logging it.
            // However, for a full OAuth redirect, we often need to break out.

            // Let's try to use the 'open' command from the global object if it exists
            try {
              window.shopify.open(authUrl, "_top");
              return new Promise(() => {});
            } catch (err) {
              // If App Bridge open fails, fall back to direct navigation
              console.error(
                "[Auth] Failed to use App Bridge open, falling back to window.location",
                err
              );
              try {
                // Check if window.top is accessible (may be null in cross-origin iframes)
                if (window.top && window.top !== window) {
                  window.top.location.href = authUrl;
                } else {
                  // Fallback to current window if top is not accessible
                  window.location.href = authUrl;
                }
              } catch (securityErr) {
                // SecurityError can occur when accessing window.top.location in cross-origin iframes
                console.error(
                  "[Auth] SecurityError accessing window.top.location, using current window",
                  securityErr
                );
                window.location.href = authUrl;
              }
              return new Promise(() => {});
            }
          } else {
            // Fallback
            try {
              // Check if window.top is accessible (may be null in cross-origin iframes)
              if (window.top && window.top !== window) {
                window.top.location.href = authUrl;
              } else {
                // Fallback to current window if top is not accessible
                window.location.href = authUrl;
              }
            } catch (securityErr) {
              // SecurityError can occur when accessing window.top.location in cross-origin iframes
              console.error(
                "[Auth] SecurityError accessing window.top.location, using current window",
                securityErr
              );
              window.location.href = authUrl;
            }
            return new Promise(() => {});
          }
        }
        errorText = data.message || data.error || JSON.stringify(data);
      } catch (e) {
        console.error("[Auth] Failed to parse 401 response", e);
        try {
          errorText = await res.clone().text();
        } catch {
          // ignore
        }
      }
    } else {
      try {
        errorText = await res.clone().text();
      } catch {
        // ignore
      }
    }

    throw new Error(`${res.status}: ${errorText}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined
): Promise<Response> {
  // console.log("[Auth apiRequest] Called for:", method, url);
  const headers: Record<string, string> = data
    ? { "Content-Type": "application/json" }
    : {};

  // Get session token
  try {
    const token = await getAuthToken();

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    } else {
      console.error("[Auth apiRequest] Session token is empty");
    }
  } catch (e) {
    console.error("[Auth apiRequest] Failed to get session token:", e);
  }

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    // console.log("[Auth Query] queryFn CALLED for:", queryKey.join("/"));
    const headers: Record<string, string> = {};

    // Get session token
    try {
      const token = await getAuthToken();

      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    } catch (e) {
      console.error("[Auth Query] Failed to get session token:", e);
    }

    const res = await fetch(queryKey.join("/") as string, {
      headers,
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);

    const jsonClone = res.clone();
    return await jsonClone.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
