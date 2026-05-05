import { bytesToHex } from "viem";

/**
 * Lazy-loaded Zama FHEVM relayer SDK instance for the browser.
 *
 * Wraps `@zama-fhe/relayer-sdk/bundle` so we only load WASM once and we can
 * generate encrypted inputs (handles + ZKPoK proof) bound to (multisig
 * contract, relayer address). Returns hex-encoded strings ready to JSON-post
 * to the relayer backend.
 */
let cached: any | null = null;

export async function getFhevmInstance() {
  if (cached) return cached;
  const mod: any = await import("@zama-fhe/relayer-sdk/bundle");
  const factory = mod.createInstance ?? mod.default?.createInstance;
  const sepoliaConfig = mod.SepoliaConfig ?? mod.default?.SepoliaConfig;
  if (!factory || !sepoliaConfig) {
    throw new Error("Zama relayer SDK does not expose createInstance / SepoliaConfig");
  }
  cached = await factory(sepoliaConfig);
  return cached;
}

function toHex(value: Uint8Array | string): `0x${string}` {
  if (typeof value === "string") {
    return value.startsWith("0x") ? (value as `0x${string}`) : (`0x${value}` as `0x${string}`);
  }
  return bytesToHex(value);
}

export async function encryptAddressFor(
  contractAddress: string,
  callerAddress: string,
  addressToEncrypt: string,
): Promise<{ handle: `0x${string}`; proof: `0x${string}` }> {
  const fhevm = await getFhevmInstance();
  const input = fhevm.createEncryptedInput(contractAddress, callerAddress);
  input.addAddress(addressToEncrypt);
  const enc = await input.encrypt();
  return { handle: toHex(enc.handles[0]), proof: toHex(enc.inputProof) };
}

export async function encryptAddressesFor(
  contractAddress: string,
  callerAddress: string,
  addressesToEncrypt: string[],
): Promise<{ handles: `0x${string}`[]; proof: `0x${string}` }> {
  const fhevm = await getFhevmInstance();
  const input = fhevm.createEncryptedInput(contractAddress, callerAddress);
  for (const a of addressesToEncrypt) input.addAddress(a);
  const enc = await input.encrypt();
  return { handles: enc.handles.map(toHex), proof: toHex(enc.inputProof) };
}
