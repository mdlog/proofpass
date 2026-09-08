import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import superjson from "superjson";
import { describe, expect, it } from "vitest";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "../contexts/ThemeContext";
import { trpc } from "../lib/trpc";
import Home from "./Home";
import type { Workspace } from "../App";

/**
 * The shell tests ARCHITECTURE §14 lists under UI: sidebar keyboard navigation,
 * the mobile drawer, and toast feedback. Every tRPC call answers "not signed
 * in", which is the state a visitor without a session actually sees, so the app
 * renders its demo path exactly as it would in a browser.
 */
function renderApp() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const trpcClient = trpc.createClient({
    links: [httpBatchLink({
      url: "http://localhost/api/trpc",
      transformer: superjson,
      fetch: async (input) =>
        new Response(
          JSON.stringify(String(input).includes("auth.me") ? [{ result: { data: { json: null } } }] : []),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    })],
  });

  function Shell() {
    const [workspace, setWorkspace] = useState<Workspace>("overview");
    return (
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider defaultTheme="light" switchable>
            <TooltipProvider>
              <Toaster position="top-right" />
              <Home workspace={workspace} onWorkspaceChange={setWorkspace} />
            </TooltipProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </trpc.Provider>
    );
  }

  render(<Shell />);
  return userEvent.setup();
}

const heading = () => screen.getByRole("heading", { level: 1 }).textContent ?? "";

describe("workspace navigation", () => {
  it("gives every page exactly one h1 (PRD §11)", async () => {
    const user = renderApp();
    for (const [label, expected] of [
      ["Credentials", "Credentials"],
      ["Proof requests", "Proof requests"],
      ["Activity", "Activity"],
      ["Settings", "Settings"],
      ["Issuer workspace", "Issue with confidence."],
      ["Verifier workspace", "Ask for less. Know enough."],
    ] as const) {
      await user.click(screen.getByRole("button", { name: new RegExp(`^${label}`) }));
      await waitFor(() => expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1));
      expect(heading()).toBe(expected);
    }
  });

  it("reaches and activates a workspace with the keyboard alone", async () => {
    const user = renderApp();
    const target = screen.getByRole("button", { name: /^Proof requests/ });

    target.focus();
    expect(target).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(heading()).toBe("Proof requests"));

    const activity = screen.getByRole("button", { name: /^Activity/ });
    activity.focus();
    await user.keyboard(" ");
    await waitFor(() => expect(heading()).toBe("Activity"));
  });
});

describe("mobile navigation drawer (ARCHITECTURE §14)", () => {
  const drawer = () => document.querySelector(".sidebar-wrap")!;

  it("opens from the menu button and closes again", async () => {
    const user = renderApp();
    expect(drawer().className).not.toContain("sidebar-wrap-open");

    await user.click(screen.getByRole("button", { name: /open navigation|menu/i }));
    await waitFor(() => expect(drawer().className).toContain("sidebar-wrap-open"));

    await user.click(screen.getByRole("button", { name: /close navigation|close menu/i }));
    await waitFor(() => expect(drawer().className).not.toContain("sidebar-wrap-open"));
  });

  it("closes when a workspace is chosen from inside the drawer", async () => {
    const user = renderApp();
    await user.click(screen.getByRole("button", { name: /open navigation|menu/i }));
    await waitFor(() => expect(drawer().className).toContain("sidebar-wrap-open"));

    await user.click(within(drawer() as HTMLElement).getByRole("button", { name: /^Settings/ }));
    await waitFor(() => expect(drawer().className).not.toContain("sidebar-wrap-open"));
  });
});

describe("toast feedback (ARCHITECTURE §14)", () => {
  it("explains, rather than fails silently, when a request needs an account", async () => {
    const user = renderApp();
    await user.click(screen.getByRole("button", { name: /^Proof requests/ }));
    await user.click(await screen.findByRole("button", { name: /create request/i }));

    // No session and no OAuth portal configured: the prompt has to say so.
    expect(await screen.findByText(/sign in to create a proof request/i)).toBeInTheDocument();
    expect(await screen.findByText(/sign-in is not configured|authenticated account/i)).toBeInTheDocument();
  });

  it("surfaces a success toast for a demo-path action", async () => {
    const user = renderApp();
    await user.click(screen.getByRole("button", { name: /^Credentials/ }));
    await user.click(await screen.findByRole("button", { name: /receive credential|add credential/i }));
    // Asserted on the toast's description: its title repeats the button label.
    expect(await screen.findByText(/your issuer invite link will appear here/i)).toBeInTheDocument();
  });
});
