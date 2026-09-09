import { describe, expect, it } from "vitest";
import { issuerForContract, lastDeployedContract, rememberDeployedContract } from "./deployedContract";

/**
 * A deployed address exists in exactly one place the moment `deployContract`
 * returns: the value in hand. It used to go to a toast and `console.info` and
 * nowhere else, so closing the tab lost the only record of a contract that had
 * already cost DUST to put on chain.
 */

const store = () => {
  const held = new Map<string, string>();
  return { getItem: (key: string) => held.get(key) ?? null, setItem: (key: string, value: string) => void held.set(key, value), held };
};

const issuer = (id: number, networkId: string, contractAddress: string | null = null) => ({ id, networkId, contractAddress, displayName: `Issuer ${id}` });

describe("rememberDeployedContract", () => {
  it("keeps the address where a reload can still find it", () => {
    const kept = store();
    rememberDeployedContract({ contractAddress: "0200abc", networkId: "preprod" }, kept);
    expect(lastDeployedContract(kept)).toMatchObject({ contractAddress: "0200abc", networkId: "preprod" });
  });

  it("records when it happened, so two deploys are tellable apart", () => {
    const kept = store();
    const at = new Date("2026-09-09T15:37:23.000Z");
    rememberDeployedContract({ contractAddress: "0200abc", networkId: "preprod" }, kept, at);
    expect(lastDeployedContract(kept)?.deployedAt).toBe(at.toISOString());
  });

  it("reports nothing rather than throwing when nothing was ever deployed", () => {
    expect(lastDeployedContract(store())).toBeNull();
  });

  it("survives a store that refuses to write, because the toast still has the address", () => {
    const refusing = { getItem: () => null, setItem: () => { throw new Error("storage disabled"); } };
    expect(() => rememberDeployedContract({ contractAddress: "0200abc", networkId: "preprod" }, refusing)).not.toThrow();
  });
});

describe("issuerForContract", () => {
  it("prefers an issuer that has no contract yet", () => {
    const chosen = issuerForContract([issuer(1, "preprod", "0200old"), issuer(2, "preprod")], "preprod");
    expect(chosen?.id).toBe(2);
  });

  it("falls back to the most recent, which the registry already orders first", () => {
    const chosen = issuerForContract([issuer(3, "preprod", "0200old"), issuer(1, "preprod", "0200older")], "preprod");
    expect(chosen?.id).toBe(3);
  });

  it("never attaches a preprod contract to a preview issuer", () => {
    expect(issuerForContract([issuer(1, "preview")], "preprod")).toBeNull();
  });

  it("returns nothing when there is no issuer to attach to", () => {
    expect(issuerForContract([], "preprod")).toBeNull();
  });
});
