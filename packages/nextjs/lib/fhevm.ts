/**
 * Lazy-loaded Zama FHEVM relayer SDK instance for the browser.
 *
 * Wraps `@zama-fhe/relayer-sdk/bundle` so we only load WASM once and we can
 * generate encrypted inputs (handles + ZKPoK proof) bound to (multisig
 * contract, relayer address).
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

export async function encryptAddressFor(
  contractAddress: string,
  callerAddress: string,
  addressToEncrypt: string,
): Promise<{ handle: string; proof: string }> {
  const fhevm = await getFhevmInstance();
  const input = fhevm.createEncryptedInput(contractAddress, callerAddress);
  input.addAddress(addressToEncrypt);
  const enc = await input.encrypt();
  return {
    handle: typeof enc.handles[0] === "string" ? enc.handles[0] : "0x" + Buffer.from(enc.handles[0]).toString("hex"),
    proof: typeof enc.inputProof === "string" ? enc.inputProof : "0x" + Buffer.from(enc.inputProof).toString("hex"),
  };
}

export async function encryptAddressesFor(
  contractAddress: string,
  callerAddress: string,
  addressesToEncrypt: string[],
): Promise<{ handles: string[]; proof: string }> {
  const fhevm = await getFhevmInstance();
  const input = fhevm.createEncryptedInput(contractAddress, callerAddress);
  for (const a of addressesToEncrypt) input.addAddress(a);
  const enc = await input.encrypt();
  return {
    handles: enc.handles.map((h: any) => (typeof h === "string" ? h : "0x" + Buffer.from(h).toString("hex"))),
    proof: typeof enc.inputProof === "string" ? enc.inputProof : "0x" + Buffer.from(enc.inputProof).toString("hex"),
  };
}
