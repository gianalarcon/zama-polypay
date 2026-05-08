import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

/**
 * Deploys the singleton HiddenERC20 ("hUSD") used as the only payroll token
 * in Polypay-Zama. The same address is shared by every multisig account on
 * Sepolia; record it in `packages/backend/.env` and the frontend constants
 * after running `yarn deploy --tags HiddenERC20`.
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer, relayer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;
  const network = hre.network.name;

  const relayerAddr = process.env.RELAYER_ADDRESS ?? relayer;
  if (!relayerAddr) {
    throw new Error(
      `RELAYER_ADDRESS missing for HiddenERC20 deploy on ${network}.\n` +
        `Set RELAYER_ADDRESS in packages/hardhat/.env (same EOA as the backend relayer).`,
    );
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(relayerAddr)) {
    throw new Error(`RELAYER_ADDRESS invalid (got ${relayerAddr}).`);
  }

  console.log(`Deploying HiddenERC20 (hUSD) on ${network}`);
  console.log(`  deployer = ${deployer}`);
  console.log(`  relayer  = ${relayerAddr}`);

  const result = await deploy("HiddenERC20", {
    from: deployer,
    args: [relayerAddr],
    log: true,
    autoMine: true,
  });

  console.log(`\nHiddenERC20 deployed at ${result.address}`);
  console.log(`Save this for backend + frontend: HUSD_ADDRESS=${result.address}`);
};

export default func;
func.id = "deploy_hidden_erc20";
func.tags = ["HiddenERC20"];
