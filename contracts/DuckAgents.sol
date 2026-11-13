// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice A desk toy as one token.
///
/// The token is the physical pairing and the ERC-8004 agent. An NFC tag stores
/// a URL whose hash is the slug. `tokenIdFor` is that slug's token. There is no
/// chip signature and no transfer: every token is minted to `desk` and stays there.
/// Another toy is another `pair` call. Nothing here caps the supply.
contract DuckAgents is ERC721URIStorage, Ownable {
    /// @notice Wallet that holds every duck. Set to the deployer.
    address public immutable desk;

    uint256 private _nextId = 1;

    mapping(string nfcSlug => uint256 tokenId) private _tokenIdFor;
    mapping(uint256 tokenId => string nfcSlug) private _slugOf;
    string[] private _slugs;

    mapping(uint256 agentId => mapping(string key => bytes value)) private _metadata;

    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
    event MetadataSet(
        uint256 indexed agentId,
        string indexed indexedMetadataKey,
        string metadataKey,
        bytes metadataValue
    );
    event URIUpdated(uint256 indexed agentId, string newUri, address indexed updatedBy);

    error EmptySlug();
    error SlugAlreadyPaired();
    error TransferDisabled();
    error RenounceDisabled();
    error AgentWalletReserved();
    error AgentBindingImmutable();

    constructor() ERC721("Desk Ducks", "DUCK") Ownable(msg.sender) {
        desk = msg.sender;
    }

    /// @notice Mint the next token to `desk` and map `nfcSlug` to it.
    ///         `agentURI` is the ERC-8004 registration file.
    function pair(string calldata nfcSlug, string calldata agentURI) external onlyOwner returns (uint256 agentId) {
        string memory slug = _normalizeSlug(nfcSlug);
        if (_tokenIdFor[slug] != 0) revert SlugAlreadyPaired();

        agentId = _nextId;
        _nextId = agentId + 1;

        _tokenIdFor[slug] = agentId;
        _slugOf[agentId] = slug;
        _slugs.push(slug);

        _mint(desk, agentId);
        if (bytes(agentURI).length > 0) {
            _setTokenURI(agentId, agentURI);
        }

        _writeMetadata(agentId, "agentWallet", abi.encodePacked(desk));
        emit Registered(agentId, agentURI, desk);
    }

    /// @notice Token id for an NFC slug. `0` means the tag is not a desk duck.
    function tokenIdFor(string calldata nfcSlug) external view returns (uint256) {
        return _tokenIdFor[_normalizeSlug(nfcSlug)];
    }

    function slugOf(uint256 tokenId) external view returns (string memory) {
        ownerOf(tokenId);
        return _slugOf[tokenId];
    }

    function slugCount() external view returns (uint256) {
        return _slugs.length;
    }

    function slugAt(uint256 index) external view returns (string memory) {
        return _slugs[index];
    }

    function nextAgentId() external view returns (uint256) {
        return _nextId;
    }

    function getMetadata(uint256 agentId, string memory metadataKey) external view returns (bytes memory) {
        ownerOf(agentId);
        return _metadata[agentId][metadataKey];
    }

    function setMetadata(uint256 agentId, string memory metadataKey, bytes memory metadataValue) external onlyOwner {
        ownerOf(agentId);
        _setMetadata(agentId, metadataKey, metadataValue);
    }

    function setAgentURI(uint256 agentId, string calldata newURI) external onlyOwner {
        ownerOf(agentId);
        _setTokenURI(agentId, newURI);
        emit URIUpdated(agentId, newURI, msg.sender);
    }

    /// @notice Pairing more ducks later depends on this contract keeping an owner.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert TransferDisabled();
        return super._update(to, tokenId, auth);
    }

    function _writeMetadata(uint256 agentId, string memory metadataKey, bytes memory metadataValue) internal {
        _metadata[agentId][metadataKey] = metadataValue;
        emit MetadataSet(agentId, metadataKey, metadataKey, metadataValue);
    }

    function _setMetadata(uint256 agentId, string memory metadataKey, bytes memory metadataValue) internal {
        bytes32 keyHash = keccak256(bytes(metadataKey));
        if (keyHash == keccak256(bytes("agentWallet"))) revert AgentWalletReserved();
        if (keyHash == keccak256(bytes("agent-binding"))) {
            if (_metadata[agentId][metadataKey].length != 0) revert AgentBindingImmutable();
        }
        _writeMetadata(agentId, metadataKey, metadataValue);
    }

    /// @dev ASCII A-Z become a-z, so a tag written as `#Minecraft` still matches.
    function _normalizeSlug(string memory slug) internal pure returns (string memory) {
        bytes memory raw = bytes(slug);
        if (raw.length == 0) revert EmptySlug();
        for (uint256 i = 0; i < raw.length; i++) {
            if (raw[i] >= 0x41 && raw[i] <= 0x5A) {
                raw[i] = bytes1(uint8(raw[i]) + 32);
            }
        }
        return string(raw);
    }
}
