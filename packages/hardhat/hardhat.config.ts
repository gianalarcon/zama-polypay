import * as dotenv from "dotenv";
dotenv.config();
import { HardhatUserConfig } from "hardhat/config";
import "@fhevm/hardhat-plugin";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-verify";
import "@typechain/hardhat";
import "hardhat-deploy";
import "hardhat-deploy-ethers";
import "hardhat-gas-reporter";
import "solidity-coverage";

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY ?? "";
const SEPOLIA_RPC_URL =
  process.env.SEPOLIA_RPC_URL ??
  (ALCHEMY_API_KEY
    ? `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
    : "https://ethereum-sepolia.publicnode.com");
const DEPLOYER_PRIVATE_KEY =
  process.env.DEPLOYER_PRIVATE_KEY ?? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY ?? "";

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  namedAccounts: {
    deployer: { default: 0 },
    relayer: { default: 1 },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    sepolia: {
      url: SEPOLIA_RPC_URL,
      accounts: [DEPLOYER_PRIVATE_KEY],
      chainId: 11155111,
    },
  },
  solidity: {
    version: "0.8.27",
    settings: {
      optimizer: { enabled: true, runs: 800 },
      evmVersion: "cancun",
    },
  },
  etherscan: {
    apiKey: { sepolia: ETHERSCAN_API_KEY },
  },
  typechain: {
    outDir: "types",
    target: "ethers-v6",
  },
};

export default config;
