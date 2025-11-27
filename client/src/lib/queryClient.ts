import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { getSessionToken } from "@shopify/app-bridge/utilities";
import { Redirect } from "@shopify/app-bridge/actions";

// Store the App Bridge instance globally
let appBridgeInstance: any = null;
let appBridgeResolve: ((app: any) => void) | null = null;
const appBridgePromise = new Promise((resolve) => {
  appBridgeResolve = resolve;
});

export function setAppBridge(app: any) {
  appBridgeInstance = app;
  console.log(
    "[Auth] App Bridge instance set, type:",
    typeof app,
    "has subscribe:",
    typeof app?.subscribe,
    "has dispatch:",
    typeof app?.dispatch,
    "constructor:",
    app?.constructor?.name
  );

  // Resolve the promise so waiting queries can proceed
  if (appBridgeResolve) {
    appBridgeResolve(app);
  }
}

// Helper to wait for App Bridge to be ready
async function waitForAppBridge(): Promise<any> {
  if (appBridgeInstance) {
    return appBridgeInstance;
  }
  console.log("[Auth] Waiting for App Bridge to initialize...");
  return await appBridgePromise;
}

// Helper to get session token from URL parameter (Shopify provides this on initial load)
function getSessionTokenFromUrl(): string | null {
  const urlParams = new URLSearchParams(window.location.search);
  const idToken = urlParams.get("id_token");
  if (idToken) {
    console.log("[Auth] Found id_token in URL, length:", idToken.length);
    return idToken;
  }
  return null;
}

// Helper to get fresh session token
async function getAuthToken(): Promise<string> {
  // Always get fresh token from App Bridge
  console.log("[Auth] Fetching fresh session token from App Bridge...");
  const app = await waitForAppBridge();

  // Add timeout to detect hanging
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error("getSessionToken timeout after 5s")),
      5000
    );
  });

  const token = (await Promise.race([
    getSessionToken(app),
    timeoutPromise,
  ])) as string;

  console.log("[Auth] Got fresh token from App Bridge, length:", token.length);
  return token;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    // Clone the response before reading it, so we can read it multiple times if needed
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

          // Use App Bridge to redirect the top-level window
          // This is required because we are in an iframe and need to break out for OAuth
          try {
            const app = await waitForAppBridge();
            const redirect = Redirect.create(app);

            // Redirect to our backend auth endpoint
            // The backend will then redirect to Shopify's OAuth page
            // We use REMOTE because we are navigating away from the embedded app view temporarily
            const authUrl = `${window.location.origin}/api/auth?shop=${data.shop}`;
            redirect.dispatch(Redirect.Action.REMOTE, authUrl);

            // Return a promise that never resolves to pause execution while redirecting
            return new Promise(() => {});
          } catch (err) {
            console.error(
              "[Auth] Failed to use App Bridge for redirect, falling back to window.location",
              err
            );
            window.location.href = `/api/auth?shop=${data.shop}`;
            return new Promise(() => {});
          }
        }
        // If we got JSON but no retryAuth, use the error message from JSON
        errorText = data.message || data.error || JSON.stringify(data);
      } catch (e) {
        console.error(
          "[Auth] Failed to parse 401 response for re-auth details",
          e
        );
        // If JSON parsing fails, try to get text error message from a fresh clone
        try {
          const textClone = res.clone();
          errorText = await textClone.text();
        } catch (textError) {
          // If that fails, just use status text
          errorText = res.statusText;
        }
      }
    } else {
      // For non-401 errors, read the response text from cloned response
      try {
        const textClone = res.clone();
        errorText = await textClone.text();
      } catch (textError) {
        errorText = res.statusText;
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
  console.log("[Auth apiRequest] Called for:", method, url);
  const headers: Record<string, string> = data
    ? { "Content-Type": "application/json" }
    : {};

  // Get session token
  try {
    const token = await getAuthToken();

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
      console.log(
        "[Auth apiRequest] Session token added to headers successfully"
      );
    } else {
      console.error("[Auth apiRequest] Session token is empty");
    }
  } catch (e) {
    console.error("[Auth apiRequest] Failed to get session token:", e);
    console.error(
      "[Auth apiRequest] Error details:",
      e instanceof Error ? e.message : String(e)
    );
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
    console.log("[Auth Query] queryFn CALLED for:", queryKey.join("/"));
    const headers: Record<string, string> = {};

    // Get session token
    try {
      const token = await getAuthToken();

      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
        console.log("[Auth Query] Session token added to headers successfully");
      } else {
        console.error("[Auth Query] Session token is empty");
      }
    } catch (e) {
      console.error("[Auth Query] Failed to get session token:", e);
      console.error(
        "[Auth Query] Error details:",
        e instanceof Error ? e.message : String(e)
      );
    }

    const res = await fetch(queryKey.join("/") as string, {
      headers,
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);

    // Clone the response before reading JSON, in case throwIfResNotOk already read it
    // This prevents "body stream already read" errors
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
