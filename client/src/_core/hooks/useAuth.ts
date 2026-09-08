import { trpc } from "@/lib/trpc";

/**
 * Reconstructed platform hook.
 *
 * The original shipped inside the Manus-managed `_core` layer, which is absent
 * from this checkout (see the missing server/_core/{index,trpc,context,cookies,
 * systemRouter}.ts and shared/_core/errors.ts). Home.tsx and DashboardLayout.tsx
 * both import it, so the client cannot be served without it.
 *
 * It is wired to the real `auth.me` / `auth.logout` procedures declared in
 * server/routers.ts, so it keeps working once the backend is restored. With no
 * backend reachable the query simply fails and the app renders unauthenticated
 * — the demo path every tRPC query in Home.tsx is already gated on via
 * `enabled: isAuthenticated`.
 */
export function useAuth() {
  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSettled: () => {
      void meQuery.refetch();
    },
  });

  const user = meQuery.data ?? null;

  return {
    user,
    isAuthenticated: Boolean(user),
    loading: meQuery.isLoading,
    logout: () => logoutMutation.mutate(),
  };
}
