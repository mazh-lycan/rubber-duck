import { expect } from "chai";
import { network } from "hardhat";

const registration = {
  type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  name: "Minecraft",
  description: "A blocky blue duck.",
  image: "ducks/minecraft.jpg",
  services: [{ name: "web", endpoint: "https://ducks.example/#minecraft", version: "1" }],
  active: true,
  x402Support: false,
  registrations: [] as { agentId: number; agentRegistry: string }[],
  supportedTrust: [] as string[],
};

function agentURI(agentId: number, registry: string, name: string) {
  const file = {
    ...registration,
    name,
    registrations: [{ agentId, agentRegistry: `eip155:421614:${registry}` }],
  };
  return "data:application/json;base64," + Buffer.from(JSON.stringify(file)).toString("base64");
}

function decode(uri: string) {
  const encoded = uri.slice("data:application/json;base64,".length);
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as {
    name: string;
    registrations: { agentId: number; agentRegistry: string }[];
  };
}

describe("DuckAgents", function () {
  async function setup() {
    const { ethers } = await network.create();
    const [desk, stranger] = await ethers.getSigners();
    const ducks = await ethers.deployContract("DuckAgents");
    const address = await ducks.getAddress();
    return { ethers, desk, stranger, ducks, address };
  }

  it("pairs both toys to the desk, in order, and a later toy still fits", async function () {
    const { ethers, desk, ducks, address } = await setup();

    await ducks.pair("minecraft", agentURI(1, address, "Minecraft"));
    await ducks.pair("frog", agentURI(2, address, "Frog"));
    await ducks.pair("pebble", agentURI(3, address, "Pebble"));

    expect(await ducks.ownerOf(1n)).to.equal(desk.address);
    expect(await ducks.ownerOf(2n)).to.equal(desk.address);
    expect(await ducks.ownerOf(3n)).to.equal(desk.address);
    expect(await ducks.desk()).to.equal(desk.address);
    expect(await ducks.name()).to.equal("Desk Ducks");
    expect(await ducks.symbol()).to.equal("DUCK");

    expect(await ducks.tokenIdFor("minecraft")).to.equal(1n);
    expect(await ducks.tokenIdFor("FROG")).to.equal(2n);
    expect(await ducks.slugOf(1n)).to.equal("minecraft");
    expect(await ducks.slugOf(2n)).to.equal("frog");
    expect(await ducks.slugCount()).to.equal(3n);
    expect(await ducks.slugAt(0)).to.equal("minecraft");
    expect(await ducks.slugAt(1)).to.equal("frog");
    expect(await ducks.slugAt(2)).to.equal("pebble");
    expect(await ducks.nextAgentId()).to.equal(4n);

    const minecraft = decode(await ducks.tokenURI(1n));
    expect(minecraft.name).to.equal("Minecraft");
    expect(minecraft.registrations[0].agentId).to.equal(1);
    expect(minecraft.registrations[0].agentRegistry).to.equal(`eip155:421614:${address}`);

    const frog = decode(await ducks.tokenURI(2n));
    expect(frog.name).to.equal("Frog");

    const wallet = await ducks.getMetadata(1n, "agentWallet");
    expect(ethers.getAddress(ethers.hexlify(wallet))).to.equal(desk.address);
  });

  it("rejects an empty slug, a repeat slug, and a stranger", async function () {
    const { ethers, stranger, ducks, address } = await setup();
    await ducks.pair("minecraft", agentURI(1, address, "Minecraft"));

    await expect(ducks.pair("", "ipfs://empty")).to.be.revertedWithCustomError(ducks, "EmptySlug");
    await expect(ducks.pair("Minecraft", "ipfs://again")).to.be.revertedWithCustomError(
      ducks,
      "SlugAlreadyPaired",
    );
    await expect(ducks.tokenIdFor("")).to.be.revertedWithCustomError(ducks, "EmptySlug");
    expect(await ducks.tokenIdFor("missing")).to.equal(0n);

    await expect(
      ducks.connect(stranger).pair("frog", agentURI(2, address, "Frog")),
    ).to.be.revertedWithCustomError(ducks, "OwnableUnauthorizedAccount").withArgs(stranger.address);
  });

  it("keeps every token on the desk", async function () {
    const { desk, stranger, ducks, address } = await setup();
    await ducks.pair("minecraft", agentURI(1, address, "Minecraft"));

    await expect(
      ducks.transferFrom(desk.address, stranger.address, 1n),
    ).to.be.revertedWithCustomError(ducks, "TransferDisabled");

    await ducks.approve(stranger.address, 1n);
    await expect(
      ducks.connect(stranger).transferFrom(desk.address, stranger.address, 1n),
    ).to.be.revertedWithCustomError(ducks, "TransferDisabled");

    expect(await ducks.ownerOf(1n)).to.equal(desk.address);
    await expect(ducks.renounceOwnership()).to.be.revertedWithCustomError(ducks, "RenounceDisabled");
  });

  it("lets the desk update the registration and blocks agentWallet rewrites", async function () {
    const { ethers, desk, stranger, ducks, address } = await setup();
    await ducks.pair("frog", agentURI(1, address, "Frog"));

    const next = agentURI(1, address, "Frog, still");
    await ducks.setAgentURI(1n, next);
    expect(decode(await ducks.tokenURI(1n)).name).to.equal("Frog, still");

    await expect(ducks.connect(stranger).setAgentURI(1n, "ipfs://no")).to.be.revertedWithCustomError(
      ducks,
      "OwnableUnauthorizedAccount",
    ).withArgs(stranger.address);

    await ducks.setMetadata(1n, "agentName", ethers.toUtf8Bytes("Frog"));
    expect(ethers.toUtf8String(await ducks.getMetadata(1n, "agentName"))).to.equal("Frog");

    await expect(
      ducks.setMetadata(1n, "agentWallet", ethers.getBytes(desk.address)),
    ).to.be.revertedWithCustomError(ducks, "AgentWalletReserved");

    await ducks.setMetadata(1n, "agent-binding", ethers.getBytes(desk.address));
    await expect(
      ducks.setMetadata(1n, "agent-binding", ethers.getBytes(stranger.address)),
    ).to.be.revertedWithCustomError(ducks, "AgentBindingImmutable");
  });
});
