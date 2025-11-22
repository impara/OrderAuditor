import { useQuery } from "@tanstack/react-query";
import { Redirect } from "wouter";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { data: authStatus, isLoading } = useQuery<{ isAuthenticated: boolean }>({
    queryKey: ['/api/auth/check'],
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!authStatus?.isAuthenticated) {
    return <Redirect to="/login" />;
  }

  return <>{children}</>;
}
