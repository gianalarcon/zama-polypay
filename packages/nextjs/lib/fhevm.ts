import { bytesToHex, getAddress } from "viem";

/**
 * Lazy-loaded Zama FHEVM relayer SDK instance for the browser.
 *
 * Uses the `/web` entrypoint (ESM + bundler-friendly). The `/bundle`
 * path is `<script>`-tag style and only re-exports `window.relayerSDK`,
 * so it would not work with Next.js' bundler.
 *
 * Initialisation is two-step: `initSDK()` loads the WASM module, then
 * `createInstance({ ...SepoliaConfig, network })` creates the per-user
 * instance. The `network` field is the missing piece in `SepoliaConfig`
 * (it's `Omit<FhevmInstanceConfig, 'network'>`); pass `window.ethereum`
 * so the SDK uses the connected wallet's transport.
 */
let cachedInstance: any | null = null;
let sdkInitialised = false;

export async function getFhevmInstance() {
  if (cachedInstance) return cachedInstance;

  const mod: any = await import("@zama-fhe/relayer-sdk/web");
  const initSDK = mod.initSDK ?? mod.default?.initSDK;
  const createInstance = mod.createInstance ?? mod.default?.createInstance;
  const SepoliaConfig = mod.SepoliaConfig ?? mod.default?.SepoliaConfig;
  if (!initSDK || !createInstance || !SepoliaConfig) {
    throw new Error("Zama relayer SDK does not expose initSDK / createInstance / SepoliaConfig");
  }

  if (!sdkInitialised) {
    await initSDK();
    sdkInitialised = true;
  }

  const network =
    typeof window !== "undefined" && (window as any).ethereum
      ? (window as any).ethereum
      : (process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL ?? "https://sepolia.drpc.org");

  cachedInstance = await createInstance({ ...SepoliaConfig, network });
  return cachedInstance;
}

function toHex(value: Uint8Array | string): `0x${string}` {
  if (typeof value === "string") {
    return value.startsWith("0x") ? (value as `0x${string}`) : (`0x${value}` as `0x${string}`);
  }
  return bytesToHex(value);
}

/**
 * Encrypt a list of Ethereum addresses against (contract, caller) and return
 * the hex-encoded handles + a single shared ZKPoK proof. Pass a single-element
 * array for the common one-address case.
 */
export async function encryptAddresses(
  contractAddress: string,
  callerAddress: string,
  addresses: readonly string[],
): Promise<{ handles: `0x${string}`[]; proof: `0x${string}` }> {
  const fhevm = await getFhevmInstance();
  const input = fhevm.createEncryptedInput(getAddress(contractAddress), getAddress(callerAddress));
  // Zama SDK requires EIP-55 checksummed addresses. Our commitments come
  // from keccak (lowercase); normalise via viem.getAddress before passing.
  for (const a of addresses) input.addAddress(getAddress(a));
  const enc = await input.encrypt();
  return { handles: enc.handles.map(toHex), proof: toHex(enc.inputProof) };
}
