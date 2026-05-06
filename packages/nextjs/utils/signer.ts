import { ISigner } from "~~/types/form/account";

/**
 * Polypay-Zama: a "Membership ID" is a 20-byte signature-derived
 * commitment, formatted as `0x` + 40 hex chars (eaddress shape).
 */
export const isValidCommitment = (commitment: string): boolean => {
  const trimmed = commitment?.trim();
  if (!trimmed) return false;
  return /^0x[0-9a-fA-F]{40}$/.test(trimmed);
};

export const isDuplicateCommitment = (signers: ISigner[], index: number): boolean => {
  const current = signers[index]?.commitment?.trim().toLowerCase();
  if (!current) return false;
  return signers.some((signer, i) => i !== index && signer?.commitment?.trim().toLowerCase() === current);
};

export const hasDuplicateSigners = (signers: ISigner[]): boolean => {
  const commitments = signers.map(s => s?.commitment?.trim().toLowerCase()).filter(c => c !== "");
  return new Set(commitments).size !== commitments.length;
};

export const getValidSigners = <T extends { commitment: string }>(signers: T[]): T[] => {
  return signers.filter((signer, index) => {
    if (!isValidCommitment(signer.commitment)) return false;
    return !isDuplicateCommitment(signers as any, index);
  });
};
