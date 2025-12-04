import { QueryClient, QueryFunction } from "@tanstack/react-query";

// Declare the global shopify object
declare global {
  interface Window {
    shopify: any;
  }
}

// Flag to prevent multiple simultaneous OAuth redirects
let isRedirectingToAuth = false;

// Flag to prevent multiple simultaneous reinstall confirmation dialogs
let isShowingReinstallPrompt = false;

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
        
        // Case 1: App not installed or offline session missing
        // Requires FULL OAuth with user gesture (cannot auto-redirect from iframe)
        if (data.requiresInstall && data.installUrl) {
          console.error("[Auth] App not installed. User must click to reinstall.");
          
          // Prevent multiple simultaneous reinstall prompts
          if (isShowingReinstallPrompt) {
            console.log("[Auth] Reinstall prompt already showing, skipping...");
            return new Promise(() => {}); // Pause execution indefinitely
          }
          
          isShowingReinstallPrompt = true;
          
          // Show alert to get user gesture, then redirect
          // Alert interaction counts as user gesture for navigation
          const userConfirmed = confirm(
            "Your session has expired or the app was uninstalled. Click OK to reinstall the app."
          );
          
          if (userConfirmed) {
            // User clicked OK - this provides the gesture needed for navigation
            window.top!.location.href = data.installUrl;
            return new Promise(() => {}); // Pause execution
          } else {
            // User clicked Cancel - reset flag so they can try again later
            isShowingReinstallPrompt = false;
            throw new Error("App installation required. Please refresh and try again.");
          }
        }
        
        // Case 2: Session token expired but offline session exists
        // App Bridge can handle this automatically with the header
        if (data.retryAuth && data.shop) {
          // Prevent multiple simultaneous OAuth redirects
          if (isRedirectingToAuth) {
            console.log(`[Auth] OAuth redirect already in progress, skipping...`);
            return new Promise(() => {}); // Pause execution indefinitely
          }
          
          isRedirectingToAuth = true;
          console.log(`[Auth] Redirecting to auth for shop: ${data.shop}`);

          // Construct the auth URL with exitiframe parameter
          // The exitiframe=1 parameter tells App Bridge to break out of the iframe
          // This is the Shopify-recommended way to handle OAuth redirects in embedded apps
          const authUrl = `${window.location.origin}/api/auth?shop=${data.shop}`;
          const exitiframeUrl = `/exitiframe?exitIframe=${encodeURIComponent(authUrl)}`;

          // For embedded apps (App Bridge v4), use exitiframe redirect pattern
          // This automatically breaks out of the iframe and redirects to OAuth
          // The App Bridge script in index.html handles this automatically
          if (window.shopify && window.shopify.environment?.embedded) {
            console.log("[Auth] Using exitiframe pattern for OAuth redirect in embedded app");
            window.location.href = exitiframeUrl;
          } else {
            // Not embedded - direct navigation to auth URL
            console.log("[Auth] Using direct navigation for non-embedded context");
            window.location.href = authUrl;
          }
          
          return new Promise(() => {}); // Pause execution while redirecting
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
