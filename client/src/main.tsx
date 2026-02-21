import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const dsn =
  import.meta.env.VITE_GLITCHTIP_DSN || import.meta.env.VITE_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE || "development",
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
  });
}

const root = createRoot(document.getElementById("root")!);
root.render(
  dsn ? (
    <Sentry.ErrorBoundary
      fallback={({ error, resetError }) => (
        <div
          style={{
            padding: "2rem",
            fontFamily: "system-ui, sans-serif",
            textAlign: "center",
          }}
        >
          <h2>Something went wrong</h2>
          <p style={{ color: "#666", marginBottom: "1rem" }}>
            {error instanceof Error
              ? error.message
              : typeof error === "string"
                ? error
                : "An unexpected error occurred."}
          </p>
          <button
            type="button"
            onClick={resetError}
            style={{
              padding: "0.5rem 1rem",
              cursor: "pointer",
              background: "#333",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
            }}
          >
            Try again
          </button>
        </div>
      )}
      showDialog={false}
    >
      <App />
    </Sentry.ErrorBoundary>
  ) : (
    <App />
  )
);
