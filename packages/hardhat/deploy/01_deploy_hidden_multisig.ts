import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer, relayer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;
  const network = hre.network.name;

  const relayerAddr = process.env.RELAYER_ADDRESS ?? relayer;
  if (!relayerAddr) {
    throw new Error(
      `RELAYER_ADDRESS missing.\n` +
        `Create packages/hardhat/.env with:\n` +
        `  SEPOLIA_RPC_URL=https://sepolia.drpc.org\n` +
        `  DEPLOYER_PRIVATE_KEY=0x<deployer key>\n` +
        `  RELAYER_ADDRESS=0x<relayer EOA>\n` +
        `(Network: ${network})`,
    );
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(relayerAddr)) {
    throw new Error(`RELAYER_ADDRESS invalid (got ${relayerAddr}). Must be 0x-prefixed 40-hex Ethereum address.`);
  }

  console.log(`Deploying HiddenMultisig on ${network}`);
  console.log(`  deployer = ${deployer}`);
  console.log(`  relayer  = ${relayerAddr}`);

  // hUSD is deployed by 01_deploy_hidden_erc20.ts and resolved via the
  // hardhat-deploy registry; the .env override is only for cases where the
  // template multisig is deployed against a pre-existing hUSD instance.
  const hUSDAddr = process.env.HUSD_ADDRESS ?? (await hre.deployments.getOrNull("HiddenERC20"))?.address;
  if (!hUSDAddr) {
    throw new Error(
      `hUSD address missing. Either deploy HiddenERC20 first (yarn deploy --tags HiddenERC20) ` +
        `or export an existing one via HUSD_ADDRESS in packages/hardhat/.env.`,
    );
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(hUSDAddr)) {
    throw new Error(`HUSD_ADDRESS invalid (got ${hUSDAddr}).`);
  }

  console.log(`  hUSD     = ${hUSDAddr}`);

  const result = await deploy("HiddenMultisig", {
    from: deployer,
    args: [relayerAddr, hUSDAddr],
    log: true,
    autoMine: true,
  });

  console.log(`\nHiddenMultisig deployed at ${result.address}`);
  console.log(`Save this for backend: MULTISIG_ADDRESS=${result.address}`);
};

export default func;
func.id = "deploy_hidden_multisig";
func.tags = ["HiddenMultisig"];
func.dependencies = ["HiddenERC20"];
