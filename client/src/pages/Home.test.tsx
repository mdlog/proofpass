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

/**
 * PRD §5 "Honest demo": a number is either read from the store or marked as
 * seeded. These two used to be hardcoded — "3 of 4 total" credentials and "18"
 * proofs shared — with a Demo tag doing the apologising. They now read from the
 * registry, and with no session there is nothing to read, so they show the same
 * em dash the issuer workspace already uses rather than a fabricated figure.
 */
describe("Overview metrics", () => {
  const metricCard = (label: RegExp) =>
    screen.getAllByRole("button").find((button) => label.test(button.textContent ?? ""));

  it("no longer prints a fabricated credential count", () => {
    renderApp();
    const card = metricCard(/Active credentials/);
    expect(card?.textContent).toMatch(/—/);
    expect(card?.textContent).not.toMatch(/Demo/);
  });

  it("no longer prints a fabricated count of proofs shared", () => {
    renderApp();
    const card = metricCard(/Proofs shared/);
    expect(card?.textContent).toMatch(/—/);
    expect(card?.textContent).not.toMatch(/Demo/);
  });

  /**
   * "Data kept private 86%" measured nothing. What is true and checkable is that
   * the contract's ledger fields are Bytes<32> sets and maps — an attribute
   * cannot be stored there at all.
   */
  it("replaces the invented percentage with a fact about the ledger", () => {
    renderApp();
    expect(metricCard(/Data kept private/)).toBeUndefined();
    const card = metricCard(/Attributes on chain/);
    expect(card?.textContent).toMatch(/0/);
    expect(card?.textContent).not.toMatch(/Demo/);
  });

  it("no longer scores privacy out of a hundred it never measured", () => {
    renderApp();
    expect(screen.queryByText(/92/)).toBeNull();
    expect(screen.queryByText(/privacy score/i)).toBeNull();
  });

  it("shows no block height rather than an invented one", () => {
    renderApp();
    expect(screen.queryByText(/18,420,991/)).toBeNull();
  });
});

describe("Credentials page", () => {
  it("still labels the seeded cards, which is the whole point of keeping them", async () => {
    const user = renderApp();
    await user.click(screen.getByRole("button", { name: /^Credentials/ }));
    const cards = screen.getAllByRole("button").filter((button) => /VERIFIABLE CREDENTIAL/.test(button.textContent ?? ""));
    expect(cards.length).toBeGreaterThan(0);
    // With no session nothing is stored, so every card on screen is seeded.
    for (const card of cards) expect(card.textContent).toMatch(/Demo/);
  });
});

describe("Credentials page action", () => {
  /**
   * The button used to raise a toast promising "Your issuer invite link will
   * appear here" — a link that does not exist. Credentials come from the
   * on-chain workflow, so that is where it goes.
   */
  it("takes you to where a credential actually comes from", async () => {
    const user = renderApp();
    await user.click(screen.getByRole("button", { name: /^Credentials/ }));
    await user.click(screen.getByRole("button", { name: /Issue on chain/i }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/Run it against the real contract/);
  });
});

/**
 * Settings held four toggles that forgot themselves on reload and a hardcoded
 * wallet address — "midnight1q…4r8x" — printed while a real session was
 * available. A control that looks adjustable and changes nothing is the same
 * untruth as a badge-less fabricated chart, only quieter.
 */
describe("Settings", () => {
  const openSettings = async () => {
    const user = renderApp();
    await user.click(screen.getByRole("button", { name: /^Settings/ }));
    return user;
  };

  it("prints no invented wallet address", async () => {
    await openSettings();
    expect(screen.queryByText(/midnight1q/i)).toBeNull();
  });

  it("says no wallet is connected rather than showing one that is not", async () => {
    await openSettings();
    expect(await screen.findByText(/no wallet connected/i)).toBeInTheDocument();
  });

  it("offers a theme control that actually changes the theme", async () => {
    const user = await openSettings();
    // The topbar has a theme control too; this one is the settings row.
    const row = (await screen.findByText("Dark mode")).closest(".setting-row");
    const toggle = within(row as HTMLElement).getByRole("button");
    const before = document.documentElement.classList.contains("dark");
    await user.click(toggle);
    expect(document.documentElement.classList.contains("dark")).toBe(!before);
  });

  it("offers the Midnight network the app will actually ask for", async () => {
    await openSettings();
    const group = await screen.findByRole("group", { name: /midnight network/i });
    expect(within(group).getAllByRole("button").length).toBeGreaterThan(1);
  });

  it("states the privacy guarantees as locked rather than as choices", async () => {
    await openSettings();
    const consent = await screen.findByRole("button", { name: /Ask before every proof/i });
    expect(consent).toHaveAttribute("aria-pressed", "true");
    expect(consent.className).toMatch(/toggle-locked/);
  });
});

describe("workspace navigation", () => {
  /**
   * The breadcrumb was hardcoded to "Overview", so every page claimed to be a
   * page it was not — the one piece of chrome whose whole job is saying where
   * you are.
   */
  it("names the page you are actually on", async () => {
    const user = renderApp();
    const breadcrumb = () => screen.getByRole("navigation", { name: "Breadcrumb" }).textContent ?? "";
    expect(breadcrumb()).toContain("Overview");
    for (const [label, expected] of [
      ["Activity", "Activity"],
      ["Issuer workspace", "Issuer workspace"],
      ["On-chain workflow", "On-chain workflow"],
    ] as const) {
      await user.click(screen.getByRole("button", { name: new RegExp(`^${label}`) }));
      expect(breadcrumb()).toContain(expected);
    }
  });

  it("gives every page exactly one h1 (PRD §11)", async () => {
    const user = renderApp();
    for (const [label, expected] of [
      ["Credentials", "Credentials"],
      ["Proof requests", "Proof requests"],
      ["Activity", "Activity"],
      ["Settings", "Settings"],
      ["Issuer workspace", "Issue with confidence."],
      ["Verifier workspace", "Ask for less. Know enough."],
      ["On-chain workflow", "Run it against the real contract"],
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

  /**
   * Re-pointed from the Credentials action, which used to raise a toast
   * promising an issuer invite link that did not exist. That button now
   * navigates to where credentials actually come from; Export is still a
   * demo-path action, and the point here is that a toast reaches the screen.
   */
  it("surfaces a toast for a demo-path action", async () => {
    const user = renderApp();
    await user.click(screen.getByRole("button", { name: /^Activity/ }));
    await user.click(await screen.findByRole("button", { name: /export/i }));
    expect(await screen.findByText(/export is available in the production workspace/i)).toBeInTheDocument();
  });
});

/**
 * PRD §5 "Honest demo" and ADR-003. These are regressions with teeth: the app
 * used to greet a signed-out visitor with "Wallet connected", a registry of
 * "124 credentials issued", and a full page of credentials with nothing marking
 * any of it as fabricated.
 */
describe("honest demo (PRD §5, ADR-003)", () => {
  const demoTagsIn = (root: HTMLElement | Document = document) => root.querySelectorAll(".demo-tag").length;

  it("does not claim a wallet connection there is none of", async () => {
    renderApp();
    expect(await screen.findByText(/no wallet connected/i)).toBeInTheDocument();
    expect(screen.queryByText(/^wallet connected$/i)).not.toBeInTheDocument();
  });

  it("says who is signed in, and admits when nobody is", async () => {
    renderApp();
    expect(await screen.findByText(/not signed in/i)).toBeInTheDocument();
    expect(screen.queryByText("Alex Chen")).not.toBeInTheDocument();
  });

  it("shows no sidebar badge when there is no real count behind it", () => {
    renderApp();
    expect(document.querySelectorAll(".nav-count")).toHaveLength(0);
  });

  it("marks the invented figures on the overview", async () => {
    renderApp();
    await screen.findByText(/no wallet connected/i);
    // Privacy score, the three metric cards, and the block number.
    expect(demoTagsIn()).toBeGreaterThanOrEqual(5);
  });

  it("marks every seeded credential", async () => {
    const user = renderApp();
    await user.click(screen.getByRole("button", { name: /^Credentials/ }));
    const cards = document.querySelectorAll(".credential-card");
    expect(cards.length).toBeGreaterThan(0);
    cards.forEach(card => expect(card.querySelector(".demo-tag")).not.toBeNull());
  });

  it("reports unknown registry numbers as unknown, never as invented ones", async () => {
    const user = renderApp();
    await user.click(screen.getByRole("button", { name: /^Issuer workspace/ }));
    const registry = document.querySelector(".role-control-list")!;
    expect(registry.textContent).not.toMatch(/118|124/);
    expect(registry.textContent).toContain("—");
    expect(document.querySelector(".role-hero-stat")!.textContent).toContain("—");
  });

  it("marks the seeded policy builder and registry events", async () => {
    const user = renderApp();
    await user.click(screen.getByRole("button", { name: /^Verifier workspace/ }));
    expect(document.querySelector(".policy-builder .demo-tag")).not.toBeNull();
  });
});
