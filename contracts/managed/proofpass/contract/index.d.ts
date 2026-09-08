import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export enum IssuerStatus { UNREGISTERED = 0, ACTIVE = 1, REVOKED = 2 }

export type Witnesses<PS> = {
  localSecretKey(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  registerIssuer(context: __compactRuntime.CircuitContext<PS>,
                 issuerId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  revokeIssuer(context: __compactRuntime.CircuitContext<PS>,
               issuerId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  issueCredential(context: __compactRuntime.CircuitContext<PS>,
                  issuerId_0: Uint8Array,
                  commitment_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  revokeCredential(context: __compactRuntime.CircuitContext<PS>,
                   commitment_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  proveEligibility(context: __compactRuntime.CircuitContext<PS>,
                   issuerId_0: Uint8Array,
                   expiresAt_0: bigint,
                   nonce_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  registerIssuer(context: __compactRuntime.CircuitContext<PS>,
                 issuerId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  revokeIssuer(context: __compactRuntime.CircuitContext<PS>,
               issuerId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  issueCredential(context: __compactRuntime.CircuitContext<PS>,
                  issuerId_0: Uint8Array,
                  commitment_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  revokeCredential(context: __compactRuntime.CircuitContext<PS>,
                   commitment_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  proveEligibility(context: __compactRuntime.CircuitContext<PS>,
                   issuerId_0: Uint8Array,
                   expiresAt_0: bigint,
                   nonce_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
  authorityKey(sk_0: Uint8Array): Uint8Array;
  credentialCommitment(issuerId_0: Uint8Array,
                       expiresAt_0: bigint,
                       sk_0: Uint8Array): Uint8Array;
}

export type Circuits<PS> = {
  authorityKey(context: __compactRuntime.CircuitContext<PS>, sk_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  credentialCommitment(context: __compactRuntime.CircuitContext<PS>,
                       issuerId_0: Uint8Array,
                       expiresAt_0: bigint,
                       sk_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  registerIssuer(context: __compactRuntime.CircuitContext<PS>,
                 issuerId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  revokeIssuer(context: __compactRuntime.CircuitContext<PS>,
               issuerId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  issueCredential(context: __compactRuntime.CircuitContext<PS>,
                  issuerId_0: Uint8Array,
                  commitment_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  revokeCredential(context: __compactRuntime.CircuitContext<PS>,
                   commitment_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  proveEligibility(context: __compactRuntime.CircuitContext<PS>,
                   issuerId_0: Uint8Array,
                   expiresAt_0: bigint,
                   nonce_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  issuers: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): IssuerStatus;
    [Symbol.iterator](): Iterator<[Uint8Array, IssuerStatus]>
  };
  credentials: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  revokedCredentials: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  spentNonces: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  readonly acceptedProofs: bigint;
  readonly authority: Uint8Array;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
