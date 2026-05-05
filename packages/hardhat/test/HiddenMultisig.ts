import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { expect } from "chai";
import { HiddenMultisig, HiddenMultisig__factory } from "../types";

type Signers = {
  deployer: HardhatEthersSigner;
  relayer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
  carol: HardhatEthersSigner;
  dave: HardhatEthersSigner;
  eve: HardhatEthersSigner;
  recipient: HardhatEthersSigner;
};

async function approveAs(
  multisig: HiddenMultisig,
  multisigAddress: string,
  relayer: HardhatEthersSigner,
  ownerWallet: HardhatEthersSigner,
  propId: number,
) {
  const input = fhevm.createEncryptedInput(multisigAddress, relayer.address);
  input.addAddress(ownerWallet.address);
  const enc = await input.encrypt();
  await (await multisig.connect(relayer).approve(propId, enc.handles[0], enc.inputProof)).wait();
}

async function executeProposal(multisig: HiddenMultisig, relayer: HardhatEthersSigner, propId: number) {
  await (await multisig.connect(relayer).requestExecute(propId)).wait();
  const handle = await multisig.getReadyHandle(propId);
  const dec = await fhevm.publicDecrypt([handle]);
  await (
    await multisig.connect(relayer).finalizeExecute(propId, dec.abiEncodedClearValues, dec.decryptionProof)
  ).wait();
}

describe("HiddenMultisig", function () {
  let signers: Signers;
  let multisig: HiddenMultisig;
  let multisigAddress: string;

  before(async function () {
    const eth = await ethers.getSigners();
    signers = {
      deployer: eth[0],
      relayer: eth[1],
      alice: eth[2],
      bob: eth[3],
      carol: eth[4],
      dave: eth[5],
      eve: eth[6],
      recipient: eth[7],
    };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn(`HiddenMultisig tests require FHEVM mock environment`);
      this.skip();
    }
    const factory = (await ethers.getContractFactory("HiddenMultisig")) as HiddenMultisig__factory;
    multisig = (await factory.connect(signers.deployer).deploy(signers.relayer.address)) as HiddenMultisig;
    multisigAddress = await multisig.getAddress();

    const owners = [signers.alice, signers.bob, signers.carol, signers.dave, signers.eve];
    const input = fhevm.createEncryptedInput(multisigAddress, signers.deployer.address);
    for (const o of owners) input.addAddress(o.address);
    const enc = await input.encrypt();

    await (await multisig.connect(signers.deployer).initialize(enc.handles, enc.inputProof, 3)).wait();
  });

  it("deploys with relayer set and uninitialized state", async function () {
    const factory = (await ethers.getContractFactory("HiddenMultisig")) as HiddenMultisig__factory;
    const fresh = (await factory.connect(signers.deployer).deploy(signers.relayer.address)) as HiddenMultisig;
    expect(await fresh.relayer()).to.eq(signers.relayer.address);
    expect(await fresh.initialized()).to.eq(false);
    expect(await fresh.threshold()).to.eq(0);
  });

  it("initializes with 5 encrypted owners and threshold 3", async function () {
    expect(await multisig.initialized()).to.eq(true);
    expect(await multisig.threshold()).to.eq(3);
    expect(await multisig.ownersLength()).to.eq(5);
    expect(await multisig.activeOwnerCount()).to.eq(5);
  });

  it("rejects re-initialization", async function () {
    const input = fhevm.createEncryptedInput(multisigAddress, signers.deployer.address);
    input.addAddress(signers.alice.address);
    const enc = await input.encrypt();
    await expect(multisig.initialize(enc.handles, enc.inputProof, 1)).to.be.revertedWith("already initialized");
  });

  it("rejects propose calls from non-relayer", async function () {
    await expect(
      multisig.connect(signers.alice).proposeTransfer(signers.recipient.address, 1, ethers.ZeroAddress),
    ).to.be.revertedWith("only relayer");
  });

  it("creates a transfer proposal with empty bitmap and counter zero", async function () {
    await (
      await multisig
        .connect(signers.relayer)
        .proposeTransfer(signers.recipient.address, ethers.parseEther("0.1"), ethers.ZeroAddress)
    ).wait();

    const prop = await multisig.getProposal(0);
    expect(prop.ptype).to.eq(0);
    expect(prop.executed).to.eq(false);
    expect(prop.decryptionPending).to.eq(false);
    expect(prop.approvalAttempts).to.eq(0);
  });

  it("executes transfer when threshold approvals submitted", async function () {
    await signers.deployer.sendTransaction({ to: multisigAddress, value: ethers.parseEther("1") });

    await (
      await multisig
        .connect(signers.relayer)
        .proposeTransfer(signers.recipient.address, ethers.parseEther("0.1"), ethers.ZeroAddress)
    ).wait();

    for (const owner of [signers.alice, signers.bob, signers.carol]) {
      await approveAs(multisig, multisigAddress, signers.relayer, owner, 0);
    }

    const balBefore = await ethers.provider.getBalance(signers.recipient.address);
    await executeProposal(multisig, signers.relayer, 0);

    const prop = await multisig.getProposal(0);
    expect(prop.executed).to.eq(true);
    expect(prop.ready).to.eq(true);

    const balAfter = await ethers.provider.getBalance(signers.recipient.address);
    expect(balAfter - balBefore).to.eq(ethers.parseEther("0.1"));
  });

  it("does not execute when fewer than threshold approve", async function () {
    await signers.deployer.sendTransaction({ to: multisigAddress, value: ethers.parseEther("1") });

    await (
      await multisig
        .connect(signers.relayer)
        .proposeTransfer(signers.recipient.address, ethers.parseEther("0.1"), ethers.ZeroAddress)
    ).wait();

    for (const owner of [signers.alice, signers.bob]) {
      await approveAs(multisig, multisigAddress, signers.relayer, owner, 0);
    }

    const balBefore = await ethers.provider.getBalance(signers.recipient.address);
    await executeProposal(multisig, signers.relayer, 0);

    const prop = await multisig.getProposal(0);
    expect(prop.executed).to.eq(true);
    expect(prop.ready).to.eq(false);

    const balAfter = await ethers.provider.getBalance(signers.recipient.address);
    expect(balAfter).to.eq(balBefore);
  });

  it("ignores duplicate approvals from the same signer", async function () {
    await signers.deployer.sendTransaction({ to: multisigAddress, value: ethers.parseEther("1") });

    await (
      await multisig
        .connect(signers.relayer)
        .proposeTransfer(signers.recipient.address, ethers.parseEther("0.1"), ethers.ZeroAddress)
    ).wait();

    for (let i = 0; i < 3; i++) {
      await approveAs(multisig, multisigAddress, signers.relayer, signers.alice, 0);
    }

    await executeProposal(multisig, signers.relayer, 0);
    const prop = await multisig.getProposal(0);
    expect(prop.ready).to.eq(false);
  });

  it("ignores approvals from non-owners", async function () {
    await (
      await multisig
        .connect(signers.relayer)
        .proposeTransfer(signers.recipient.address, ethers.parseEther("0.1"), ethers.ZeroAddress)
    ).wait();

    for (const wallet of [signers.alice, signers.bob, signers.recipient]) {
      await approveAs(multisig, multisigAddress, signers.relayer, wallet, 0);
    }

    await executeProposal(multisig, signers.relayer, 0);
    const prop = await multisig.getProposal(0);
    expect(prop.ready).to.eq(false);
  });

  it("set-threshold proposal updates threshold after execute", async function () {
    await (await multisig.connect(signers.relayer).proposeSetThreshold(4)).wait();

    for (const owner of [signers.alice, signers.bob, signers.carol]) {
      await approveAs(multisig, multisigAddress, signers.relayer, owner, 0);
    }

    await executeProposal(multisig, signers.relayer, 0);
    expect(await multisig.threshold()).to.eq(4);
  });

  it("remove-signer proposal soft-deletes via isActive flag", async function () {
    await (await multisig.connect(signers.relayer).proposeRemoveSigner(4)).wait();

    for (const owner of [signers.alice, signers.bob, signers.carol]) {
      await approveAs(multisig, multisigAddress, signers.relayer, owner, 0);
    }

    await executeProposal(multisig, signers.relayer, 0);

    expect(await multisig.isActive(4)).to.eq(false);
    expect(await multisig.activeOwnerCount()).to.eq(4);
    expect(await multisig.ownersLength()).to.eq(5);
  });

  it("approvals from a soft-removed owner stop counting", async function () {
    await (await multisig.connect(signers.relayer).proposeRemoveSigner(4)).wait();
    for (const owner of [signers.alice, signers.bob, signers.carol]) {
      await approveAs(multisig, multisigAddress, signers.relayer, owner, 0);
    }
    await executeProposal(multisig, signers.relayer, 0);

    await (
      await multisig.connect(signers.relayer).proposeTransfer(signers.recipient.address, 1n, ethers.ZeroAddress)
    ).wait();
    for (const owner of [signers.alice, signers.bob, signers.eve]) {
      await approveAs(multisig, multisigAddress, signers.relayer, owner, 1);
    }
    await executeProposal(multisig, signers.relayer, 1);

    const prop = await multisig.getProposal(1);
    expect(prop.ready).to.eq(false);
  });
});
