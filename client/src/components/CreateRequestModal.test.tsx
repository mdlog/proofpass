import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { NewRequestInput } from "../lib/types";
import { CreateRequestModal } from "./CreateRequestModal";

function setup(overrides: Partial<Parameters<typeof CreateRequestModal>[0]> = {}) {
  const props = { onClose: vi.fn(), onSubmit: vi.fn<(input: NewRequestInput) => void>(), isSaving: false, ...overrides };
  render(<CreateRequestModal {...props} />);
  return { props, user: userEvent.setup() };
}

const submitButton = () => screen.getByRole("button", { name: /^create request/i });

describe("fact selection (ARCHITECTURE §10)", () => {
  it("offers the three documented facts and preselects completion status", () => {
    setup();
    expect(screen.getByRole("button", { name: "Completion status" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Cohort" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Issuer" })).toHaveAttribute("aria-pressed", "false");
  });

  it("submits the documented identifiers, not the labels", async () => {
    const { props, user } = setup();
    await user.click(screen.getByRole("button", { name: "Cohort" }));
    await user.type(screen.getByRole("textbox", { name: /verifier/i }), "Northstar Academy");
    await user.type(screen.getByRole("textbox", { name: /purpose/i }), "Confirm bootcamp completion");
    await user.click(submitButton());

    expect(props.onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      verifierName: "Northstar Academy",
      purpose: "Confirm bootcamp completion",
      requestedAttributes: ["completion_status", "cohort"],
      expiresInDays: 7,
    }));
  });

  it("appends free-text facts after the presets", async () => {
    const { props, user } = setup();
    await user.type(screen.getByRole("textbox", { name: /verifier/i }), "Guild");
    await user.type(screen.getByRole("textbox", { name: /purpose/i }), "Course completion");
    await user.type(screen.getByRole("textbox", { name: /other facts/i }), "Course track, Grade");
    await user.click(submitButton());
    expect(vi.mocked(props.onSubmit).mock.calls[0][0].requestedAttributes).toEqual(["completion_status", "Course track", "Grade"]);
  });
});

describe("validation mirrors the server contract", () => {
  it("blocks submission until verifier and purpose are long enough", async () => {
    const { user } = setup();
    expect(submitButton()).toBeDisabled();
    expect(screen.getByText(/verifier needs at least 2 characters/i)).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: /verifier/i }), "Northstar");
    expect(screen.getByText(/add a purpose/i)).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();

    await user.type(screen.getByRole("textbox", { name: /purpose/i }), "Confirm completion");
    expect(submitButton()).toBeEnabled();
  });

  it("refuses a request with no facts at all", async () => {
    const { user } = setup();
    await user.type(screen.getByRole("textbox", { name: /verifier/i }), "Northstar");
    await user.type(screen.getByRole("textbox", { name: /purpose/i }), "Confirm completion");
    await user.click(screen.getByRole("button", { name: "Completion status" }));
    expect(screen.getByText(/select at least one fact/i)).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it("refuses more than twenty facts, the same ceiling the router enforces", async () => {
    const { user } = setup();
    await user.type(screen.getByRole("textbox", { name: /verifier/i }), "Northstar");
    await user.type(screen.getByRole("textbox", { name: /purpose/i }), "Confirm completion");
    await user.type(screen.getByRole("textbox", { name: /other facts/i }), Array.from({ length: 20 }, (_, i) => `f${i}`).join(", "));
    expect(screen.getByText(/at most 20 facts/i)).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });
});

describe("keyboard behaviour", () => {
  it("traps Tab and dismisses on Escape", async () => {
    const { props, user } = setup();
    const dialog = screen.getByRole("dialog");
    for (let i = 0; i < 10; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.keyboard("{Escape}");
    expect(props.onClose).toHaveBeenCalled();
  });

  it("holds Escape while a request is being saved", async () => {
    const { props, user } = setup({ isSaving: true });
    await user.keyboard("{Escape}");
    expect(props.onClose).not.toHaveBeenCalled();
  });
});
