// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice A non-upgradeable ERC20 whose entire supply is minted once.
/// @dev Uses ERC20's default 18 decimals. initialSupply_ is in base units.
contract FixedSupplyToken is ERC20 {
    error InvalidInitialSupply();

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply_,
        address recipient_
    ) ERC20(name_, symbol_) {
        if (initialSupply_ == 0) revert InvalidInitialSupply();
        _mint(recipient_, initialSupply_);
    }
}
