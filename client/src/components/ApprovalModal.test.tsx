import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApprovalModal } from "./ApprovalModal";
import type { ProofRequestView } from "../lib/types";

const request: ProofRequestView = {
  id: "db-7",
  verifier: "Northstar Academy",
  purpose: "Confirm bootcamp completion",
  attributes: ["completion_status", "issuer"],
  expires: "in 2 days",
  status: "Pending",
  logo: "N",
};

function setup(overrides: Partial<Parameters<typeof ApprovalModal>[0]> = {}) {
  const props = { request, onClose: vi.fn(), onApprove: vi.fn(), onDecline: vi.fn(), isBusy: false, ...overrides };
  render(<ApprovalModal {...props} />);
  return { props, user: userEvent.setup() };
}

describe("consent disclosure (PRD §13.5)", () => {
  it("names what is shared and what stays private, with facts as labels", () => {
    setup();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("You will share")).toBeInTheDocument();
    expect(within(dialog).getByText("Stays private")).toBeInTheDocument();
    // Stored as ARCHITECTURE §10 identifiers, rendered as human labels.
    expect(within(dialog).getByText("Completion status")).toBeInTheDocument();
    expect(within(dialog).getByText("Issuer")).toBeInTheDocument();
    expect(within(dialog).getByText("Legal name")).toBeInTheDocument();
  });

  it("hands the approved facts back to the caller", async () => {
    const { props, user } = setup();
    await user.click(screen.getByRole("button", { name: /approve proof/i }));
    expect(props.onApprove).toHaveBeenCalledWith(["completion_status", "issuer"]);
  });
});

describe("decline flow (PRD §7.2)", () => {
  it("asks for an optional reason and confirms before declining", async () => {
    const { props, user } = setup();

    await user.click(screen.getByRole("button", { name: "Decline" }));
    expect(props.onDecline).not.toHaveBeenCalled();

    const reason = screen.getByRole("textbox");
    await user.type(reason, "Cohort not required");
    await user.click(screen.getByRole("button", { name: /confirm decline/i }));

    expect(props.onDecline).toHaveBeenCalledWith("Cohort not required");
  });

  it("lets the holder back out of declining", async () => {
    const { props, user } = setup();
    await user.click(screen.getByRole("button", { name: "Decline" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: /approve proof/i })).toBeInTheDocument();
    expect(props.onDecline).not.toHaveBeenCalled();
  });
});

describe("keyboard behaviour (ARCHITECTURE §14 — focus trap)", () => {
  it("moves focus into the dialog when it opens", () => {
    setup();
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
  });

  it("keeps Tab inside the dialog instead of escaping to the page behind", async () => {
    const { user } = setup();
    const dialog = screen.getByRole("dialog");
    for (let i = 0; i < 12; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it("wraps backwards with Shift+Tab", async () => {
    const { user } = setup();
    const dialog = screen.getByRole("dialog");
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("dismisses on Escape", async () => {
    const { props, user } = setup();
    await user.keyboard("{Escape}");
    expect(props.onClose).toHaveBeenCalled();
  });

  it("ignores Escape while a decision is in flight", async () => {
    const { props, user } = setup({ isBusy: true });
    await user.keyboard("{Escape}");
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("disables both decisions while busy", () => {
    setup({ isBusy: true });
    expect(screen.getByRole("button", { name: /approving/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Decline" })).toBeDisabled();
  });
});
