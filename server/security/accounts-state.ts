import type { OperatorIdentity } from "./operators.js";
export type Account = OperatorIdentity & {
    email: string;
    active: boolean;
    revision: number;
    passwordHash: {
        salt: string;
        hash: string;
    };
    federation?: { issuer: string; subject: string; externalId: string; deleted?: boolean };
};
export type Invitation = {
    id: string;
    email: string;
    role: OperatorIdentity["role"];
    tokenHash: string;
    expiresAt: number;
};
export type IdentityState = {
    initialized: boolean;
    accounts: Account[];
    invitations: Invitation[];
    recoveries: {
        accountId: string;
        tokenHash: string;
        expiresAt: number;
    }[];
    scimGroups?: { id: string; externalId: string; displayName: string; members: string[]; revision: number; deleted?: boolean }[];
};
export const emptyIdentity = (): IdentityState => ({ initialized: false, accounts: [], invitations: [], recoveries: [] });
// Synchronous callback runs under the database identity lock. Never do KDF or I/O here.
export type IdentityChange<T> = (state: IdentityState) => {
    result: T;
    audit: {
        type: string;
        details: {
            actorId: string;
            targetId: string;
            reason: string;
        };
    };
};
