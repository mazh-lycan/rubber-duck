import { expect } from "chai";
import { network } from "hardhat";

describe("ValidationRegistry", function () {
  async function setup() {
    const { ethers } = await network.create();
    const [desk, stranger, validator] = await ethers.getSigners();
    const ducks = await ethers.deployContract("DuckAgents");
    await ducks.pair("swimsuit", "data:application/json,{}");
    const validation = await ethers.deployContract("ValidationRegistry", [await ducks.getAddress()]);
    const requestHash = ethers.id("swimsuit takes one lap");
    return { ethers, desk, stranger, validator, ducks, validation, requestHash };
  }

  it("the desk opens a request and the named validator answers 100", async function () {
    const { ethers, validator, validation, requestHash } = await setup();

    await validation.validationRequest(validator.address, 1n, "https://ducks.example/#swimsuit", requestHash);
    await validation.connect(validator).validationResponse(
      requestHash,
      100,
      "",
      ethers.ZeroHash,
      "accepted",
    );

    const [who, agentId, response, , tag] = await validation.getValidationStatus(requestHash);
    expect(who).to.equal(validator.address);
    expect(agentId).to.equal(1n);
    expect(response).to.equal(100);
    expect(tag).to.equal("accepted");
  });

  it("a stranger cannot open a request or answer one", async function () {
    const { ethers, stranger, validator, validation, requestHash } = await setup();

    await expect(
      validation.connect(stranger).validationRequest(validator.address, 1n, "https://ducks.example/#swimsuit", requestHash),
    ).to.be.revertedWith("ValidationRegistry: only owner/operator");

    await validation.validationRequest(validator.address, 1n, "https://ducks.example/#swimsuit", requestHash);
    await expect(
      validation.connect(stranger).validationResponse(requestHash, 0, "", ethers.ZeroHash, "rejected"),
    ).to.be.revertedWith("ValidationRegistry: only named validator");
  });

  it("rejects a score above 100", async function () {
    const { ethers, validator, validation, requestHash } = await setup();

    await validation.validationRequest(validator.address, 1n, "https://ducks.example/#swimsuit", requestHash);
    await expect(
      validation.connect(validator).validationResponse(requestHash, 101, "", ethers.ZeroHash, "too-high"),
    ).to.be.revertedWith("ValidationRegistry: response > 100");
  });
});
