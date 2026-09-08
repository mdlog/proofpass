import { ArrowDownRight, ArrowUpRight, CheckCircle2, XCircle } from "lucide-react";
import type { ProofRequestView } from "./types";

/**
 * Seeded demo content. It is deliberately kept apart from anything the store
 * returns — PRD §5 "Honest demo" requires the two to stay distinguishable in
 * the UI, and mixing them in one module makes that easy to lose.
 */
export const initialRequests: ProofRequestView[] = [
  {
    id: "req-7F3A",
    verifier: "Northstar Academy",
    purpose: "Confirm your bootcamp completion",
    attributes: ["Completion status", "Issuer", "Cohort 2026"],
    expires: "in 2 days",
    status: "Pending",
    logo: "N",
  },
  {
    id: "req-0B91",
    verifier: "Midnight Buildathon",
    purpose: "Verify builder eligibility",
    attributes: ["Builder status", "Issuer"],
    expires: "in 5 days",
    status: "Pending",
    logo: "M",
  },
  {
    id: "req-8D22",
    verifier: "Open Learning Guild",
    purpose: "Confirm course completion",
    attributes: ["Completion status", "Course track"],
    expires: "approved today",
    status: "Approved",
    logo: "O",
  },
];

export const activityItems = [
  { type: "approved", title: "Proof approved", detail: "Open Learning Guild · Course completion", time: "2h ago", icon: CheckCircle2 },
  { type: "issued", title: "Credential received", detail: "Northstar Academy · Cybersecurity Bootcamp", time: "12d ago", icon: ArrowDownRight },
  { type: "requested", title: "Proof request received", detail: "Midnight Buildathon · Builder eligibility", time: "14d ago", icon: ArrowUpRight },
  { type: "revoked", title: "Credential revoked", detail: "Civic Labs · Community Steward", time: "21d ago", icon: XCircle },
];
