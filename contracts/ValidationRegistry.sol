// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @notice Practice cut of ERC-8004 validation. The identity is any ERC-721.
///         For this desk, that token is DuckAgents.
contract ValidationRegistry {
    IERC721 public immutable identityRegistry;

    struct Validation {
        address validatorAddress;
        uint256 agentId;
        uint8 response;
        bytes32 responseHash;
        string tag;
        uint256 lastUpdate;
        bool requested;
    }

    mapping(bytes32 requestHash => Validation) private _validations;
    mapping(uint256 agentId => bytes32[] requestHashes) private _agentValidations;

    event ValidationRequest(
        address indexed validatorAddress,
        uint256 indexed agentId,
        string requestURI,
        bytes32 indexed requestHash
    );
    event ValidationResponse(
        address indexed validatorAddress,
        uint256 indexed agentId,
        bytes32 indexed requestHash,
        uint8 response,
        string responseURI,
        bytes32 responseHash,
        string tag
    );

    constructor(address identityRegistry_) {
        require(identityRegistry_ != address(0), "ValidationRegistry: zero identity");
        identityRegistry = IERC721(identityRegistry_);
    }

    function getIdentityRegistry() external view returns (address) {
        return address(identityRegistry);
    }

    function validationRequest(
        address validatorAddress,
        uint256 agentId,
        string calldata requestURI,
        bytes32 requestHash
    ) external {
        address owner = identityRegistry.ownerOf(agentId);
        bool authorized = msg.sender == owner
            || identityRegistry.getApproved(agentId) == msg.sender
            || identityRegistry.isApprovedForAll(owner, msg.sender);
        if (!authorized) {
            revert("ValidationRegistry: only owner/operator");
        }
        if (validatorAddress == address(0)) {
            revert("ValidationRegistry: zero validator");
        }
        if (_validations[requestHash].requested) {
            revert("ValidationRegistry: requestHash already used");
        }
        _validations[requestHash] = Validation({
            validatorAddress: validatorAddress,
            agentId: agentId,
            response: 0,
            responseHash: bytes32(0),
            tag: "",
            lastUpdate: 0,
            requested: true
        });
        _agentValidations[agentId].push(requestHash);
        emit ValidationRequest(validatorAddress, agentId, requestURI, requestHash);
    }

    function validationResponse(
        bytes32 requestHash,
        uint8 response,
        string calldata responseURI,
        bytes32 responseHash,
        string calldata tag
    ) external {
        Validation storage v = _validations[requestHash];
        if (!v.requested) {
            revert("ValidationRegistry: unknown request");
        }
        if (msg.sender != v.validatorAddress) {
            revert("ValidationRegistry: only named validator");
        }
        if (response > 100) {
            revert("ValidationRegistry: response > 100");
        }
        v.response = response;
        v.responseHash = responseHash;
        v.tag = tag;
        v.lastUpdate = block.timestamp;
        emit ValidationResponse(
            v.validatorAddress,
            v.agentId,
            requestHash,
            response,
            responseURI,
            responseHash,
            tag
        );
    }

    function getValidationStatus(bytes32 requestHash)
        external
        view
        returns (
            address validatorAddress,
            uint256 agentId,
            uint8 response,
            bytes32 responseHash,
            string memory tag,
            uint256 lastUpdate
        )
    {
        Validation storage v = _validations[requestHash];
        require(v.requested, "ValidationRegistry: unknown request");
        return (v.validatorAddress, v.agentId, v.response, v.responseHash, v.tag, v.lastUpdate);
    }
}
