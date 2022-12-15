import { Contract } from "ethers";
import { ethers, network } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import AbracadabraAbi from "./abi/Abracadabra.json";
import ERC20Abi from "./abi/ERC20.json";
import BentoboxAbi from "./abi/Bentobox.json";
import UniswapAbi from "./abi/Uniswap.json";

describe("Start Abracadabra", async () => {
  let user: SignerWithAddress;
  let Abracadabra: Contract;
  let impersonatedSigner: SignerWithAddress;
  let SHIB: Contract;
  let MIM: Contract;
  let BentoboxContract: Contract;
  let Uniswap: Contract;

  const abracadabraAddress = "0x252dCf1B621Cc53bc22C256255d2bE5C8c32EaE4";
  const bentoboxAddress = "0xF5BCE5077908a1b7370B9ae04AdC565EBd643966";
  const impersonatedAccount = "0x73af3bcf944a6559933396c1577b257e2054d935";
  const SHIBAddress = "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE";
  const MIMAddress = "0x99D8a9C45b2ecA8864373A26D1459e3Dff1e17F3";
  const WethAddress = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  const uniswapAddress = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
  const provider = await network.provider;
  const initSupply = 2023958000;
  const collateralFee = 0.0075;
  const Leverage = 2;

  beforeEach(async () => {
    [user] = await ethers.getSigners();
    Abracadabra = await ethers.getContractAt(AbracadabraAbi, abracadabraAddress);
    Uniswap = await ethers.getContractAt(UniswapAbi, uniswapAddress);
    // xSUSHI = await ethers.getContractAt(xSUSHIAbi, xSUSHIAddress);
    SHIB = await ethers.getContractAt(ERC20Abi, SHIBAddress);
    MIM = await ethers.getContractAt(ERC20Abi, MIMAddress);
    BentoboxContract = await ethers.getContractAt(BentoboxAbi, bentoboxAddress);

    await provider.request({
      method: "hardhat_impersonateAccount",
      params: [impersonatedAccount],
    });

    impersonatedSigner = await ethers.getSigner(impersonatedAccount);

    await SHIB.connect(impersonatedSigner).transfer(user.address, initSupply);
    await SHIB.connect(user).approve(BentoboxContract.address, initSupply);
  });

  describe("Borrow", () => {
    it("Start", async () => {
      const collateralEncode = ethers.utils.defaultAbiCoder.encode(
        ["int256", "address", "bool"],
        [initSupply, user.address, false],
      );

      const borrowEncode = ethers.utils.defaultAbiCoder.encode(["int256", "address"], [1000, user.address]);

      const updateEncode = ethers.utils.defaultAbiCoder.encode(["bool", "uint256", "uint256"], [true, "0x00", "0x00"]);

      const depositEncode = ethers.utils.defaultAbiCoder.encode(
        ["address", "address", "int256", "int256"],
        [SHIBAddress, user.address, 0, initSupply],
      );

      const bentoWithdrawEncode = ethers.utils.defaultAbiCoder.encode(
        ["address", "address", "int256", "int256"],
        [MIMAddress, user.address, 500, 0],
      );

      const approvalEncode = await getApprovalEncode(user);

      console.log("before borrowing: ", await SHIB.balanceOf(user.address));

      await Abracadabra.connect(user).cook(
        [24, 11, 20, 10, 5, 21],
        [0, 0, 0, 0, 0, 0],
        [approvalEncode, updateEncode, depositEncode, collateralEncode, borrowEncode, bentoWithdrawEncode],
        {
          value: 0,
        },
      );

      console.log("after borrowing: ", await SHIB.balanceOf(user.address));
      console.log("MIM balance: ", await MIM.balanceOf(user.address));

      await MIM.connect(user).approve(uniswapAddress, 500);
      await Uniswap.connect(user).swapExactTokensForTokens(
        500,
        0,
        [MIMAddress, WethAddress, SHIBAddress],
        user.address,
        100000000000,
      );

      let userBalance = parseInt(await SHIB.balanceOf(user.address));
      console.log("After swapping: ", await SHIB.balanceOf(user.address));

      do {
        await SHIB.connect(user).approve(BentoboxContract.address, initSupply);
        await Abracadabra.connect(user).cook(
          [20, 10, 5, 21],
          [0, 0, 0, 0],
          [depositEncode, collateralEncode, borrowEncode, bentoWithdrawEncode],
          {
            value: 0,
          },
        );

        await MIM.connect(user).approve(uniswapAddress, 500);
        await Uniswap.connect(user).swapExactTokensForTokens(
          500,
          0,
          [MIMAddress, WethAddress, SHIBAddress],
          user.address,
          100000000000,
        );

        console.log("After swapping: ", await SHIB.balanceOf(user.address));
        userBalance = parseInt(await SHIB.balanceOf(user.address));
      } while (userBalance >= initSupply * Leverage);

      console.log("the user balance after leveraging: ", userBalance);
    });
  });

  const getApprovalEncode = async (account: SignerWithAddress) => {
    const verifyingContract = await Abracadabra.bentoBox();
    const masterContract = await Abracadabra.masterContract();
    const nonce = parseInt(await BentoboxContract.nonces(account.address));
    const chainId = await (await ethers.provider.getNetwork()).chainId;

    const domain = {
      name: "BentoBox V1",
      chainId,
      verifyingContract,
    };

    // The named list of all type definitions
    const types = {
      SetMasterContractApproval: [
        { name: "warning", type: "string" },
        { name: "user", type: "address" },
        { name: "masterContract", type: "address" },
        { name: "approved", type: "bool" },
        { name: "nonce", type: "uint256" },
      ],
    };

    // The data to sign
    const value = {
      warning: "Give FULL access to funds in (and approved to) BentoBox?",
      user: account.address,
      masterContract,
      approved: true,
      nonce,
    };

    let signature;

    try {
      signature = await account._signTypedData(domain, types, value);
    } catch (e: any) {
      console.log("SIG ERR:", e.code);
      if (e.code === -32603) {
        return "ledger";
      }
      return false;
    }

    const parsedSignature = parseSignature(signature);

    return ethers.utils.defaultAbiCoder.encode(
      ["address", "address", "bool", "uint8", "bytes32", "bytes32"],
      [account.address, masterContract, true, parsedSignature.v, parsedSignature.r, parsedSignature.s],
    );
  };

  const parseSignature = (signature: string) => {
    const parsedSignature = signature.substring(2);

    const r = parsedSignature.substring(0, 64);
    const s = parsedSignature.substring(64, 128);
    const v = parsedSignature.substring(128, 130);

    return {
      r: "0x" + r,
      s: "0x" + s,
      v: parseInt(v, 16),
    };
  };
});
