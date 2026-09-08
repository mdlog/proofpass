import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RequestRow } from "./ProofRequestCard";
import type { ProofRequestView, RequestStatus } from "../lib/types";

function row(overrides: Partial<ProofRequestView> = {}): ProofRequestView {
  return {
    id: "db-7", verifier: "Northstar Academy", purpose: "Confirm bootcamp completion",
    attributes: ["completion_status", "issuer"], expires: "in 2 days", status: "Pending", logo: "N",
    ...overrides,
  };
}

describe("honest demo labelling (PRD §5)", () => {
  it("labels a seeded row", () => {
    render(<RequestRow request={row({ id: "req-7F3A" })} onApprove={vi.fn()} />);
    expect(screen.getByText("Demo")).toBeInTheDocument();
  });

  it("leaves a stored row unlabelled", () => {
    render(<RequestRow request={row()} onApprove={vi.fn()} />);
    expect(screen.queryByText("Demo")).not.toBeInTheDocument();
  });
});

describe("review affordance follows status", () => {
  it("offers Review while pending and reports the id upward", async () => {
    const onApprove = vi.fn();
    render(<RequestRow request={row()} onApprove={onApprove} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /review/i }));
    expect(onApprove).toHaveBeenCalledWith("db-7");
  });

  it.each(["Approved", "Declined", "Expired"] as RequestStatus[])("withdraws Review once %s", (status) => {
    render(<RequestRow request={row({ status })} onApprove={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /review/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /request options/i })).toBeInTheDocument();
  });

  it("shows the status and the attribute count", () => {
    render(<RequestRow request={row()} onApprove={vi.fn()} />);
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("2 attributes requested")).toBeInTheDocument();
  });
});
