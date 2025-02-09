const sdk = require("@defillama/sdk");
const abi = require("../helper/abis/blindex.json");
const { calculateUniTvl } = require("../helper/calculateUniTvl.js");
const { formatAddressChecksum } = require("../helper/formatAddressChecksum.js");

//-------------------------------------------------------------------------------------------------------------
// How to add a new chain?
// 1. Add it to the chains global array
// 2. create a function to calculate the TVL of the chain (similar to what we did with the 'rskTvl' function)
// 3. Add your new chain to the export module
// 4. Add your new chain to the 'sumChainTvls' function in the export module
//-------------------------------------------------------------------------------------------------------------

// Test on the RSK network:
// Go to @defilama/sdk/build/computetvl/blocks.js and add 'rsk' to the chainsForBlocks array

const chains = {
  rsk: {
    uniswapFactoryAddress: "0x5Af7cba7CDfE30664ab6E06D8D2210915Ef73c2E",
    bdxTokenAddress: "0x6542a10E68cEAc1Fa0641ec0D799a7492795AAC1",
    // If a token doesn't exist on CoinGecko, map it to the base token it wrappes
    coingeckoMapping: {
      prefix: "rsk",
      "0x542fda317318ebf1d3deaf76e0b632741a7e677d": "rootstock", // RSK's WRBTC
      "0x1d931bf8656d795e50ef6d639562c5bd8ac2b78f": "ethereum", // RSK's ETHs
    },
  },
};

function mapCoingeckoAddress(chainName, address) {
  let mappedName =
    chains[chainName].coingeckoMapping[address] ||
    chains[chainName].coingeckoMapping[address.toLowerCase()];

  if (!mappedName) {
    const addressPrefix =
      chainName === "ethereum"
        ? ""
        : `${chains[chainName].coingeckoMapping["prefix"]}:`;
    mappedName = `${addressPrefix}${formatAddressChecksum(address, chainName)}`;
  }

  return mappedName;
}

async function getBDStableCollateralBalances(block, chainName, bdstable) {
  const collateralPoolsLength = (
    await sdk.api.abi.call({
      target: formatAddressChecksum(bdstable.address, chainName),
      abi: abi["getBdStablesPoolsLength"],
      chain: chainName,
      block,
    })
  ).output;

  const bdstableCollateralPools = [];
  for (let index = 0; index < collateralPoolsLength; index++) {
    const poolAddress = (
      await sdk.api.abi.call({
        target: formatAddressChecksum(bdstable.address, chainName),
        abi: abi["bdstable_pools_array"],
        params: index,
        chain: chainName,
        block,
      })
    ).output;

    bdstableCollateralPools.push(poolAddress);
  }

  const balances = {};

  for (let index = 0; index < bdstableCollateralPools.length; index++) {
    const collateralAddress = await (
      await sdk.api.abi.call({
        target: formatAddressChecksum(
          bdstableCollateralPools[index],
          chainName
        ),
        abi: abi["getBDStablePoolCollateral"],
        chain: chainName,
        block,
      })
    ).output;

    const coingeckoMappedName = mapCoingeckoAddress(
      chainName,
      collateralAddress
    );
    const collateralBalance = await getBalanceOfWithPercision(
      block,
      chainName,
      formatAddressChecksum(bdstableCollateralPools[index], chainName),
      collateralAddress
    );

    balances[coingeckoMappedName] = balances.hasOwnProperty(coingeckoMappedName)
      ? balances[coingeckoMappedName] + collateralBalance
      : collateralBalance;
  }

  const bdxTokenAddress = chains[chainName].bdxTokenAddress;
  const coingeckoMapBdxAddress = mapCoingeckoAddress(
    chainName,
    bdxTokenAddress
  );

  balances[coingeckoMapBdxAddress] += await getBalanceOfWithPercision(
    block,
    chainName,
    formatAddressChecksum(bdstable.address, chainName),
    formatAddressChecksum(bdxTokenAddress, chainName)
  );

  return balances;
}

async function getBalanceOfWithPercision(block, chainName, owner, target) {
  let balance = (
    await sdk.api.erc20.balanceOf({
      target: formatAddressChecksum(target, chainName),
      owner: formatAddressChecksum(owner, chainName),
      chain: chainName,
      block,
    })
  ).output;

  const decimals = (
    await sdk.api.erc20.decimals(
      formatAddressChecksum(target, chainName),
      chainName
    )
  ).output;
  return balance / 10 ** decimals;
}

function sumBalances(balancesArray) {
  return balancesArray.reduce((balances, singleBalance) => {
    for (const [coingeckoTokenId, amount] of Object.entries(singleBalance)) {
      if (!balances[coingeckoTokenId]) {
        balances[coingeckoTokenId] = 0;
      }

      balances[coingeckoTokenId] += amount;
    }

    console.log("=======================");
    console.log(balances);
    return balances;
  }, {});
}

async function uniswapV2Tvl(block, chainName) {
  const rawBalances = await calculateUniTvl(
    (address) => formatAddressChecksum(address, chainName),
    block,
    chainName,
    formatAddressChecksum(chains[chainName].uniswapFactoryAddress, chainName),
    0,
    true
  );

  const tokensAddresses = Object.keys(rawBalances);
  const balances = {};

  for (let index = 0; index < tokensAddresses.length; index++) {
    const currentToken = tokensAddresses[index];
    const decimals = (
      await sdk.api.erc20.decimals(
        formatAddressChecksum(currentToken, chainName),
        chainName
      )
    ).output;

    balances[mapCoingeckoAddress(chainName, currentToken)] =
      rawBalances[currentToken] / 10 ** decimals;
  }

  return balances;
}

async function getAllBDStables(block, bdxTokenAddress, chainName) {
  const bdStables = [];
  const bdstablesLength = (
    await sdk.api.abi.call({
      target: formatAddressChecksum(bdxTokenAddress, chainName),
      abi: abi["getBdStablesLength"],
      chain: chainName,
      block,
    })
  ).output;

  for (let index = 0; index < bdstablesLength; index++) {
    bdStables.push({
      address: (
        await sdk.api.abi.call({
          target: formatAddressChecksum(bdxTokenAddress, chainName),
          abi: abi["getBDStable"],
          chain: chainName,
          block,
          params: index,
        })
      ).output,
    });
  }

  return bdStables;
}

async function tvl(chainName, block) {
  const balancesArray = [];

  //=======
  // AMM
  //=======
  balancesArray.push(await uniswapV2Tvl(block, chainName));

  //===================
  // Collateral
  //===================
  const bdstables = await getAllBDStables(
    block,
    chains[chainName].bdxTokenAddress,
    chainName
  );
  for (let index = 0; index < bdstables.length; index++) {
    balancesArray.push(
      await getBDStableCollateralBalances(block, chainName, bdstables[index])
    );
  }

  console.log(balancesArray);
  return sumBalances(balancesArray);
}

const rsk = async function rskTvl(timestamp, ethBlock, chainblocks) {
  return tvl("rsk", chainblocks["rsk"]);
};

module.exports = {
  misrepresentedTokens: true,
  methodology:
    "(1) AMM LP pairs - All the liquidity pools from the Factory address are used to find the LP pairs. (2) Collateral - All the collateral being used to support the stable coins - Bitcoin, Ethereum & BDX",
  rsk: {
    tvl: rsk,
  },
  tvl: sdk.util.sumChainTvls([rsk]),
};
