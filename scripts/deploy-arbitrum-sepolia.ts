import { network } from "hardhat";
import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ARBITRUM_SEPOLIA = 421614;
const FEE_FLOOR = 200_000_000n;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const baseUrl = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");
if (!baseUrl) {
  throw new Error(
    "Set PUBLIC_BASE_URL to the origin where web/index.html is hosted, with no trailing slash.",
  );
}

const { ethers } = await network.create("arbitrumSepolia");
const chainId = Number((await ethers.provider.getNetwork()).chainId);
if (chainId !== ARBITRUM_SEPOLIA) {
  throw new Error(`Expected Arbitrum Sepolia (${ARBITRUM_SEPOLIA}), connected to ${chainId}`);
}

const [deployer] = await ethers.getSigners();
console.log("deployer:", deployer.address);

async function feeOverrides(bump = 3n) {
  const [block, data] = await Promise.all([
    ethers.provider.getBlock("latest"),
    ethers.provider.getFeeData(),
  ]);
  const base = block?.baseFeePerGas ?? 0n;
  const suggested = data.maxFeePerGas ?? 0n;
  const tip = data.maxPriorityFeePerGas ?? 0n;
  const reference = base > suggested ? base : suggested;
  let maxFeePerGas = reference * bump;
  if (maxFeePerGas < FEE_FLOOR) maxFeePerGas = FEE_FLOOR;
  if (maxFeePerGas < tip) maxFeePerGas = tip;
  return { maxFeePerGas, maxPriorityFeePerGas: tip };
}

function baseFeeTooLow(error: unknown): boolean {
  return String(error).toLowerCase().includes("max fee per gas");
}

async function send(label: string, build: (fees: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }) => Promise<{ wait: () => Promise<unknown> }>) {
  try {
    const tx = await build(await feeOverrides());
    return await tx.wait();
  } catch (error) {
    if (!baseFeeTooLow(error)) throw error;
    console.log(label + ": base fee moved, retrying with a higher max fee");
    const tx = await build(await feeOverrides(6n));
    return await tx.wait();
  }
}

type Registration = {
  image?: string;
  imageCid?: string;
  services?: { name: string; endpoint: string; version: string }[];
  registrations?: { agentId: number; agentRegistry: string }[];
  updatedAt?: string;
};

function agentURI(source: Registration, slug: string, agentId: bigint, contractAddress: string) {
  const registration: Registration = structuredClone(source);
  const cid = registration.imageCid?.trim().replace(/^ipfs:\/\//, "");
  delete registration.imageCid;
  registration.image = cid ? `ipfs://${cid}` : `${baseUrl}/ducks/${slug}.jpg`;
  if (registration.services?.[0]) {
    registration.services[0].endpoint = `${baseUrl}/#${slug}`;
  }
  registration.registrations = [
    {
      agentId: Number(agentId),
      agentRegistry: `eip155:${ARBITRUM_SEPOLIA}:${ethers.getAddress(contractAddress)}`,
    },
  ];
  registration.updatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  return "data:application/json;base64," + Buffer.from(JSON.stringify(registration)).toString("base64");
}

const catalog = JSON.parse(await readFile(join(root, "metadata/catalog.json"), "utf8")) as string[];
if (!Array.isArray(catalog) || catalog.length === 0) {
  throw new Error("metadata/catalog.json needs at least one slug.");
}

async function deployAgents() {
  try {
    const deployed = await ethers.deployContract("DuckAgents", [], await feeOverrides());
    await deployed.waitForDeployment();
    return deployed;
  } catch (error) {
    if (!baseFeeTooLow(error)) throw error;
    console.log("DuckAgents: base fee moved, retrying with a higher max fee");
    const deployed = await ethers.deployContract("DuckAgents", [], await feeOverrides(6n));
    await deployed.waitForDeployment();
    return deployed;
  }
}

async function deployValidation(identity: string) {
  try {
    const deployed = await ethers.deployContract("ValidationRegistry", [identity], await feeOverrides());
    await deployed.waitForDeployment();
    return deployed;
  } catch (error) {
    if (!baseFeeTooLow(error)) throw error;
    console.log("ValidationRegistry: base fee moved, retrying with a higher max fee");
    const deployed = await ethers.deployContract("ValidationRegistry", [identity], await feeOverrides(6n));
    await deployed.waitForDeployment();
    return deployed;
  }
}

const existingAddress = process.env.DUCK_AGENTS_ADDRESS?.trim();
const agents = existingAddress
  ? await ethers.getContractAt("DuckAgents", existingAddress)
  : await deployAgents();
if (!existingAddress) console.log("deployed:", await agents.getAddress());

const contractAddress = ethers.getAddress(await agents.getAddress());
const existingValidation = process.env.VALIDATION_REGISTRY_ADDRESS?.trim();
const validation = existingValidation
  ? await ethers.getContractAt("ValidationRegistry", existingValidation)
  : await deployValidation(contractAddress);
const validationAddress = ethers.getAddress(await validation.getAddress());
if (!existingValidation) console.log("validation:", validationAddress);

const paired: { slug: string; agentId: string }[] = [];

for (const slug of catalog) {
  const metadataPath = join(root, "metadata", `${slug}.json`);
  const imagePath = join(root, "web/ducks", `${slug}.jpg`);
  await access(metadataPath);
  await access(imagePath);
  const source = JSON.parse(await readFile(metadataPath, "utf8")) as Registration;

  const already = await agents.tokenIdFor(slug);
  if (already !== 0n) {
    const uri = agentURI(source, slug, already, contractAddress);
    await send(slug, (fees) => agents.setAgentURI(already, uri, fees));
    console.log(`${slug}: updated agent ${already}`);
    console.log(`  tag: ${baseUrl}/#${slug}`);
    paired.push({ slug, agentId: already.toString() });
    continue;
  }

  const agentId = await agents.nextAgentId();
  const uri = agentURI(source, slug, agentId, contractAddress);
  await send(slug, (fees) => agents.pair(slug, uri, fees));
  console.log(`${slug}: paired as agent ${agentId}`);
  console.log(`  tag: ${baseUrl}/#${slug}`);
  paired.push({ slug, agentId: agentId.toString() });
}

const out = {
  chainId: ARBITRUM_SEPOLIA,
  rpcUrl: process.env.ARBITRUM_SEPOLIA_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc",
  address: contractAddress,
  validation: validationAddress,
  desk: ethers.getAddress(await agents.desk()),
  explorer: "https://sepolia.arbiscan.io",
  ducks: paired,
};

const target = join(root, "web/contracts.json");
await writeFile(target, JSON.stringify(out, null, 2) + "\n");
console.log("wrote", target);
console.log("https://sepolia.arbiscan.io/address/" + contractAddress);
