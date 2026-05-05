import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer, relayer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const relayerAddr = process.env.RELAYER_ADDRESS ?? relayer;
  if (!relayerAddr) throw new Error("RELAYER_ADDRESS missing");

  const result = await deploy("HiddenMultisig", {
    from: deployer,
    args: [relayerAddr],
    log: true,
    autoMine: true,
  });

  console.log(`HiddenMultisig deployed at ${result.address}, relayer = ${relayerAddr}`);
};

export default func;
func.id = "deploy_hidden_multisig";
func.tags = ["HiddenMultisig"];
