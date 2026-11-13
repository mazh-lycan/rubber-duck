import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { configVariable, defineConfig } from "hardhat/config";
import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";

const root = dirname(fileURLToPath(import.meta.url));
const envPath = join(root, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export default defineConfig({
  plugins: [hardhatToolboxMochaEthers],
  solidity: {
    version: "0.8.24",
    settings: {
      evmVersion: "cancun",
      viaIR: true,
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    arbitrumSepolia: {
      type: "http",
      chainType: "generic",
      chainId: 421614,
      url: configVariable("ARBITRUM_SEPOLIA_RPC_URL", {
        default: "https://sepolia-rollup.arbitrum.io/rpc",
      }),
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
    },
  },
});
