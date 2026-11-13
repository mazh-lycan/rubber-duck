import { ethers } from "https://esm.sh/ethers@6.15.0";

const ABI = [
  "function desk() view returns (address)",
  "function tokenIdFor(string) view returns (uint256)",
  "function slugOf(uint256) view returns (string)",
  "function slugCount() view returns (uint256)",
  "function slugAt(uint256) view returns (string)",
  "function tokenURI(uint256) view returns (string)",
  "function ownerOf(uint256) view returns (address)",
  "function getMetadata(uint256,string) view returns (bytes)",
  "function setAgentURI(uint256,string)",
  "function setMetadata(uint256,string,bytes)",
];

const VALIDATION_ABI = [
  "function validationRequest(address,uint256,string,bytes32)",
  "function validationResponse(bytes32,uint8,string,bytes32,string)",
  "function getValidationStatus(bytes32) view returns (address,uint256,uint8,bytes32,string,uint256)",
];

const MODEL = "HuggingFaceTB/SmolLM2-135M-Instruct";
const PINATA = "https://gateway.pinata.cloud/ipfs/";

const app = document.querySelector("#app");
let renderToken = 0;
let modelPromise = null;

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else if (value != null && value !== false) node.setAttribute(key, String(value));
  }
  for (const child of children) {
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function field(label, control) {
  return el("label", {}, [label, control]);
}

function slugFromHash() {
  const raw = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  if (!raw) return "";
  try {
    return decodeURIComponent(raw).split(/[/?]/)[0].trim().toLowerCase();
  } catch {
    return "";
  }
}

function localPhoto(slug) {
  return `ducks/${slug}.jpg`;
}

function ipfsHttp(value) {
  const bare = String(value || "").trim().replace(/^ipfs:\/\//, "");
  return bare ? PINATA + bare : "";
}

function photoSrc(slug, registration) {
  const cid = registration?.imageCid?.trim();
  if (cid) return ipfsHttp(cid);
  const image = registration?.image || "";
  if (image.startsWith("ipfs://")) return ipfsHttp(image);
  if (/^(https?:|data:)/.test(image)) return image;
  return localPhoto(slug);
}

function duckImage(slug, registration) {
  const name = registration?.name || slug;
  const img = el("img", { src: photoSrc(slug, registration), alt: name });
  const fallback = localPhoto(slug);
  img.addEventListener("error", () => {
    if (!img.getAttribute("src")?.endsWith(fallback)) img.src = fallback;
  });
  return img;
}

async function readRegistration(uri) {
  const marker = "data:application/json;base64,";
  if (uri.startsWith(marker)) {
    return JSON.parse(atob(uri.slice(marker.length)));
  }
  if (uri.startsWith("data:application/json,")) {
    return JSON.parse(decodeURIComponent(uri.slice("data:application/json,".length)));
  }
  const response = await fetch(uri);
  if (!response.ok) throw new Error("The registration file did not load.");
  return response.json();
}

async function fetchOk(urls) {
  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // The next path may be the one this host serves.
    }
  }
  return null;
}

async function localCatalog() {
  const catalog = await fetchOk(["./metadata/catalog.json", "../metadata/catalog.json"]);
  if (!catalog) throw new Error("The duck list did not load.");
  const slugs = await catalog.json();
  const ducks = [];
  for (const slug of slugs) {
    const file = await fetchOk([`./metadata/${slug}.json`, `../metadata/${slug}.json`]);
    if (!file) continue;
    ducks.push({ slug, agentId: "", owner: "", registration: await file.json(), uri: "" });
  }
  return ducks;
}

function readProvider(config) {
  return new ethers.JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: true });
}

function contractFrom(config, signer) {
  return new ethers.Contract(config.address, ABI, signer || readProvider(config));
}

function validationFrom(config, signer) {
  return new ethers.Contract(config.validation, VALIDATION_ABI, signer || readProvider(config));
}

async function duckById(ducks, slug, agentId) {
  const id = BigInt(agentId);
  const [uri, owner] = await Promise.all([ducks.tokenURI(id), ducks.ownerOf(id)]);
  return {
    slug,
    agentId: id.toString(),
    owner,
    uri,
    registration: await readRegistration(uri),
  };
}

async function duckFromChain(ducks, slug, config) {
  try {
    const agentId = await ducks.tokenIdFor(slug);
    if (agentId === 0n) return null;
    const [uri, owner, storedSlug] = await Promise.all([
      ducks.tokenURI(agentId),
      ducks.ownerOf(agentId),
      ducks.slugOf(agentId),
    ]);
    return {
      slug: storedSlug,
      agentId: agentId.toString(),
      owner,
      uri,
      registration: await readRegistration(uri),
    };
  } catch {
    const listed = (config.ducks || []).find((item) => item.slug === slug);
    if (listed?.agentId) return duckById(ducks, slug, listed.agentId);
    return { useLocal: true };
  }
}

async function catalogFromChain(ducks, config) {
  try {
    const count = Number(await ducks.slugCount());
    const slugs = await Promise.all(Array.from({ length: count }, (_, index) => ducks.slugAt(index)));
    const found = [];
    for (const slug of slugs) found.push(await duckFromChain(ducks, slug, config));
    return found.filter((duck) => duck && !duck.useLocal);
  } catch {
    const listed = config.ducks || [];
    if (listed.length === 0) return null;
    const local = await localCatalog();
    const found = [];
    for (const item of listed) {
      if (!item.agentId) {
        const card = local.find((duck) => duck.slug === item.slug);
        if (card) found.push(card);
        continue;
      }
      found.push(await duckById(ducks, item.slug, item.agentId));
    }
    return found;
  }
}

function registryLine(config, duck) {
  if (!config.address || !duck.agentId) return "";
  return `eip155:${config.chainId}:${config.address}:${duck.agentId}`;
}

function card(duck) {
  const name = duck.registration?.name || duck.slug;
  return el("a", { class: "card", href: `#${duck.slug}` }, [
    duckImage(duck.slug, duck.registration),
    el("div", {}, [
      el("h2", {}, [name]),
      el("p", {}, [duck.agentId ? `Agent ${duck.agentId}` : "Waiting for the desk wallet"]),
    ]),
  ]);
}

function renderHome(config, ducks, banner) {
  document.title = "Desk ducks";
  app.replaceChildren();
  if (banner) app.append(el("p", { class: "note" }, [banner]));
  if (ducks.length === 0) {
    app.append(el("section", { class: "panel hero-copy" }, [el("p", { class: "prompt" }, ["No ducks are paired yet."])]));
    return;
  }
  app.append(el("section", { class: "grid" }, ducks.map(card)));
}

function renderMissing(slug) {
  document.title = "Not a desk duck";
  app.replaceChildren(
    el("a", { class: "back", href: "./" }, ["All ducks"]),
    el("section", { class: "panel hero-copy" }, [
      el("p", { class: "kicker" }, ["Unpaired tag"]),
      el("h1", {}, ["This tag is not a desk duck"]),
      el("p", { class: "prompt" }, [`Nothing is paired to “${slug}”.`]),
    ]),
  );
}

function fact(label, value) {
  return el("li", {}, [el("span", {}, [label]), value]);
}

async function copyText(button, text) {
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied";
  } catch {
    button.textContent = "Select the text below";
  }
  setTimeout(() => {
    button.textContent = original;
  }, 1600);
}

function sameAddress(left, right) {
  try {
    return ethers.getAddress(left) === ethers.getAddress(right);
  } catch {
    return false;
  }
}

async function quietAccount() {
  if (!window.ethereum) return "";
  const accounts = await window.ethereum.request({ method: "eth_accounts" });
  return accounts?.[0] || "";
}

async function connectWallet(config) {
  if (!window.ethereum) throw new Error("This browser has no wallet. Install MetaMask.");
  const chainHex = `0x${Number(config.chainId).toString(16)}`;
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainHex }],
    });
  } catch (error) {
    if (error?.code !== 4902) throw error;
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: chainHex,
        chainName: "Arbitrum Sepolia",
        nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
        rpcUrls: [config.rpcUrl],
        blockExplorerUrls: [config.explorer],
      }],
    });
  }
  const provider = new ethers.BrowserProvider(window.ethereum);
  return provider.getSigner();
}

function fail(status, error) {
  status.textContent = error?.shortMessage || error?.reason || error?.message || "The wallet call failed.";
}

function agentTools(config, duck) {
  const status = el("p", { class: "prompt" }, ["Connect a wallet to identify or validate this duck."]);
  const walletLine = el("p", { class: "prompt" }, ["Reading agentWallet…"]);
  const connect = el("button", { type: "button" }, ["Connect wallet"]);
  const uriInput = el("textarea", { rows: "4" }, []);
  uriInput.value = duck.uri || "";
  const metaKey = el("input", { type: "text", placeholder: "agentName" });
  const metaValue = el("input", { type: "text", placeholder: "Swimsuit" });
  const updateUri = el("button", { type: "button" }, ["Update agent URI"]);
  const setMeta = el("button", { class: "ghost", type: "button" }, ["Set metadata"]);

  const validatorInput = el("input", { type: "text", placeholder: "0x validator" });
  const noteInput = el("textarea", { rows: "3", placeholder: "The note whose hash is the request" });
  const ask = el("button", { type: "button" }, ["Ask this validator"]);
  const hashKey = `duck-validation:${config.address}:${duck.agentId}`;
  const hashInput = el("input", { type: "text", placeholder: "0x request hash" });
  hashInput.value = localStorage.getItem(hashKey) || "";
  const read = el("button", { class: "ghost", type: "button" }, ["Read result"]);
  const result = el("p", { class: "prompt" }, []);
  const answer = el("div", { class: "actions" }, []);

  contractFrom(config).getMetadata(duck.agentId, "agentWallet").then((value) => {
    const hex = ethers.hexlify(value);
    walletLine.textContent = hex === "0x"
      ? "agentWallet is empty."
      : `agentWallet ${ethers.getAddress(hex)}`;
  }).catch((error) => {
    walletLine.textContent = error?.shortMessage || error?.message || "agentWallet could not be read.";
  });

  async function signerIfOwner() {
    const signer = await connectWallet(config);
    const account = await signer.getAddress();
    status.textContent = `Connected ${account}.`;
    if (!sameAddress(account, duck.owner)) {
      throw new Error("Only the desk wallet can change this duck.");
    }
    return signer;
  }

  connect.addEventListener("click", async () => {
    try {
      const signer = await connectWallet(config);
      status.textContent = `Connected ${(await signer.getAddress())}.`;
    } catch (error) {
      fail(status, error);
    }
  });

  updateUri.addEventListener("click", async () => {
    try {
      const signer = await signerIfOwner();
      const tx = await contractFrom(config, signer).setAgentURI(duck.agentId, uriInput.value);
      status.textContent = "Updating the agent URI…";
      await tx.wait();
      status.textContent = "Agent URI updated. Reload the duck to read it back.";
    } catch (error) {
      fail(status, error);
    }
  });

  setMeta.addEventListener("click", async () => {
    const key = metaKey.value.trim();
    if (!key) {
      status.textContent = "Metadata needs a key.";
      return;
    }
    try {
      const signer = await signerIfOwner();
      const tx = await contractFrom(config, signer).setMetadata(duck.agentId, key, ethers.toUtf8Bytes(metaValue.value));
      status.textContent = "Writing metadata…";
      await tx.wait();
      status.textContent = `Metadata ${key} is set.`;
    } catch (error) {
      fail(status, error);
    }
  });

  ask.addEventListener("click", async () => {
    if (!config.validation) {
      status.textContent = "The validation registry is not in contracts.json yet.";
      return;
    }
    if (!ethers.isAddress(validatorInput.value.trim())) {
      status.textContent = "That validator address is not valid.";
      return;
    }
    if (!noteInput.value.trim()) {
      status.textContent = "Write a note. Its hash is the request.";
      return;
    }
    try {
      const signer = await signerIfOwner();
      const hash = ethers.id(noteInput.value);
      const tx = await validationFrom(config, signer).validationRequest(
        ethers.getAddress(validatorInput.value.trim()),
        duck.agentId,
        location.href,
        hash,
      );
      status.textContent = "Asking the validator…";
      await tx.wait();
      localStorage.setItem(hashKey, hash);
      hashInput.value = hash;
      status.textContent = "Validation requested. The hash is saved in this browser.";
    } catch (error) {
      fail(status, error);
    }
  });

  async function respond(hash, score, tag) {
    try {
      const signer = await connectWallet(config);
      const tx = await validationFrom(config, signer).validationResponse(hash, score, "", ethers.ZeroHash, tag);
      status.textContent = "Sending the answer…";
      await tx.wait();
      status.textContent = `Answered ${score}.`;
      await showStatus();
    } catch (error) {
      fail(status, error);
    }
  }

  async function showStatus() {
    const hash = hashInput.value.trim();
    if (!ethers.isHexString(hash, 32)) {
      result.textContent = "Paste a 32-byte request hash.";
      answer.replaceChildren();
      return;
    }
    const [validator, agentId, response, , tag, updated] = await validationFrom(config).getValidationStatus(hash);
    const when = updated === 0n ? "not yet" : new Date(Number(updated) * 1000).toISOString();
    result.textContent = `Validator ${validator}. Agent ${agentId}. Score ${response}. Tag ${tag || "none"}. Updated ${when}.`;
    answer.replaceChildren();
    const account = await quietAccount();
    if (account && sameAddress(account, validator)) {
      const accept = el("button", { type: "button" }, ["Accept"]);
      const reject = el("button", { class: "ghost", type: "button" }, ["Reject"]);
      accept.addEventListener("click", () => respond(hash, 100, "accepted"));
      reject.addEventListener("click", () => respond(hash, 0, "rejected"));
      answer.append(accept, reject);
    }
  }

  read.addEventListener("click", async () => {
    if (!config.validation) {
      status.textContent = "The validation registry is not in contracts.json yet.";
      return;
    }
    try {
      await showStatus();
    } catch (error) {
      answer.replaceChildren();
      fail(result, error);
    }
  });

  const validationBlock = config.validation
    ? [
        el("p", { class: "kicker" }, ["Validation"]),
        field("Validator", validatorInput),
        field("Note", noteInput),
        el("div", { class: "actions" }, [ask]),
        field("Request hash", hashInput),
        el("div", { class: "actions" }, [read]),
        result,
        answer,
      ]
    : [el("p", { class: "prompt" }, ["The validation registry is not in contracts.json yet."])];

  return el("section", { class: "panel tools" }, [
    el("p", { class: "kicker" }, ["Identity"]),
    el("h2", {}, ["This duck on chain"]),
    el("p", { class: "prompt" }, [`Owner ${duck.owner}.`]),
    walletLine,
    status,
    el("div", { class: "actions" }, [connect]),
    field("Agent URI", uriInput),
    el("div", { class: "actions" }, [updateUri]),
    field("Metadata key", metaKey),
    field("Metadata value", metaValue),
    el("div", { class: "actions" }, [setMeta]),
    ...validationBlock,
  ]);
}

function loadModel(onStatus) {
  if (!modelPromise) {
    modelPromise = import("https://esm.sh/@huggingface/transformers@3.7.3")
      .then(async ({ pipeline, env }) => {
        env.allowLocalModels = false;
        env.useBrowserCache = true;
        return pipeline("text-generation", MODEL, {
          dtype: "q4f16",
          device: "wasm",
          progress_callback: (info) => {
            if (info.status === "progress" && info.file) {
              onStatus(`Downloading ${info.file}… ${Math.round(info.progress || 0)}%`);
            } else if (info.status === "initiate" && info.file) {
              onStatus(`Fetching ${info.file}`);
            }
          },
        });
      })
      .catch((error) => {
        modelPromise = null;
        throw error;
      });
  }
  return modelPromise;
}

function replyText(output, question) {
  const generated = output?.[0]?.generated_text;
  if (Array.isArray(generated)) return generated.at(-1)?.content || "";
  return String(generated || "").replace(question, "").trim();
}

function chatPanel(duck) {
  const description = duck.registration?.description || "You are a rubber duck on a desk.";
  const status = el("p", { class: "prompt" }, [
    "This chat runs in your browser. The first message downloads a small model. GitHub does not run it, and there is no API key.",
  ]);
  const input = el("textarea", { rows: "3", placeholder: "Talk through the problem" });
  const talk = el("button", { type: "button" }, ["Talk"]);
  const reply = el("p", { class: "prompt" }, []);
  talk.addEventListener("click", async () => {
    const question = input.value.trim();
    if (!question) {
      status.textContent = "Ask the duck something first.";
      return;
    }
    talk.disabled = true;
    try {
      status.textContent = "Loading the model…";
      const generator = await loadModel((text) => {
        status.textContent = text;
      });
      const output = await generator(
        [
          { role: "system", content: description },
          { role: "user", content: question },
        ],
        { max_new_tokens: 60, temperature: 0.7, do_sample: true },
      );
      reply.textContent = replyText(output, question) || "The duck stayed quiet.";
      status.textContent = "Answered in this browser.";
    } catch (error) {
      status.textContent = error?.message || "The model did not load.";
    } finally {
      talk.disabled = false;
    }
  });
  return el("section", { class: "panel tools" }, [
    el("p", { class: "kicker" }, ["Talk"]),
    el("h2", {}, [duck.registration?.name || duck.slug]),
    status,
    input,
    el("div", { class: "actions" }, [talk]),
    reply,
  ]);
}

function renderDuck(config, duck) {
  const name = duck.registration?.name || duck.slug;
  document.title = name;
  const line = registryLine(config, duck);
  const shown = { ...duck.registration };
  delete shown.imageCid;
  const pretty = JSON.stringify(shown, null, 2);
  const copyRegistration = el("button", { type: "button" }, ["Copy registration"]);
  copyRegistration.addEventListener("click", () => copyText(copyRegistration, pretty));
  const actions = [copyRegistration];
  if (line) {
    const copyLine = el("button", { class: "ghost", type: "button" }, ["Copy registry line"]);
    copyLine.addEventListener("click", () => copyText(copyLine, line));
    actions.push(copyLine);
  }
  if (config.address && duck.agentId) {
    actions.push(
      el("a", {
        class: "button ghost",
        href: `${config.explorer}/nft/${config.address}/${duck.agentId}`,
        target: "_blank",
        rel: "noreferrer",
      }, ["View token"]),
    );
  }

  const facts = [
    fact("NFC slug", duck.slug),
    fact("Token", duck.agentId || "not minted"),
    fact("Held by", duck.owner || "the desk wallet, once deployed"),
  ];
  if (line) facts.push(fact("Attach as", line));

  const section = el("section", { class: "panel hero" }, [
    duckImage(duck.slug, duck.registration),
    el("div", { class: "hero-copy" }, [
      el("p", { class: "kicker" }, ["Desk agent"]),
      el("h1", {}, [name]),
      el("p", { class: "prompt" }, [duck.registration?.description || ""]),
      el("ul", { class: "meta" }, facts),
      el("div", { class: "actions" }, actions),
      el("pre", {}, [pretty]),
    ]),
  ]);

  const pieces = [el("a", { class: "back", href: "./" }, ["All ducks"]), section];
  if (config.address && duck.agentId) pieces.push(agentTools(config, duck));
  pieces.push(chatPanel(duck));
  app.replaceChildren(el("div", { class: "stack" }, pieces));
}

function renderStatus(message) {
  app.replaceChildren(el("p", { class: "status" }, [message]));
}

async function render() {
  const token = ++renderToken;
  const slug = slugFromHash();
  const current = () => token === renderToken;
  renderStatus("Reading the desk…");
  let config;
  try {
    const response = await fetch("./contracts.json");
    config = await response.json();
  } catch {
    if (current()) renderStatus("contracts.json did not load.");
    return;
  }
  if (!current()) return;

  const onChain = Boolean(config.address);
  const waiting = config.identity
    ? `Identity ${config.identity} and validation ${config.validation} are on Arbitrum Sepolia. The duck tokens are not registered yet. Run npm run deploy:arbitrum-sepolia from this repo.`
    : "These toys are not on a chain yet. Deploy the contract and the tag resolves to the token.";
  try {
    if (!onChain) {
      const ducks = await localCatalog();
      if (!current()) return;
      if (!slug) {
        renderHome(config, ducks, waiting);
        return;
      }
      const duck = ducks.find((item) => item.slug === slug);
      if (!duck) renderMissing(slug);
      else {
        renderDuck(config, duck);
        app.prepend(el("p", { class: "note" }, [waiting]));
      }
      return;
    }

    const ducks = contractFrom(config);
    if (!slug) {
      const catalog = await catalogFromChain(ducks, config);
      if (!current()) return;
      if (!catalog) {
        renderHome(config, await localCatalog(), waiting);
        return;
      }
      renderHome(config, catalog, "");
      return;
    }
    const duck = await duckFromChain(ducks, slug, config);
    if (!current()) return;
    if (duck?.useLocal) {
      const local = (await localCatalog()).find((item) => item.slug === slug);
      if (!local) renderMissing(slug);
      else {
        renderDuck(config, local);
        app.prepend(el("p", { class: "note" }, [waiting]));
      }
      return;
    }
    if (!duck) renderMissing(slug);
    else renderDuck(config, duck);
  } catch (error) {
    if (!current()) return;
    renderStatus(error?.shortMessage || error?.message || "The desk could not be read.");
  }
}

window.addEventListener("hashchange", () => {
  void render();
});
void render();
