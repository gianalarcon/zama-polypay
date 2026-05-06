type NetworkMeta = {
  name: string;
  icon: string;
  badge: string;
};

const SEPOLIA_CHAIN_ID = 11155111;

const NETWORK_META_BY_CHAIN_ID: Record<number, NetworkMeta> = {
  [SEPOLIA_CHAIN_ID]: {
    name: "Sepolia",
    icon: "/token/zen.svg",
    badge: "/token/zen.svg",
  },
};

export const getDefaultChainId = (): number => SEPOLIA_CHAIN_ID;

export const getNetworkMeta = (chainId: number): NetworkMeta => {
  return NETWORK_META_BY_CHAIN_ID[chainId] ?? NETWORK_META_BY_CHAIN_ID[SEPOLIA_CHAIN_ID];
};

export const getNetworkBadgeSrc = (chainId: number): string => {
  return getNetworkMeta(chainId).badge;
};
