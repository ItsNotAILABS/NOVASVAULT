#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const solc = require('solc');

const root = path.resolve(__dirname, '..');
const sourceName = 'contracts/FixedSupplyToken.sol';
const contractName = 'FixedSupplyToken';
const source = fs.readFileSync(path.join(root, sourceName), 'utf8');
const settings = {
  optimizer: { enabled: true, runs: 200 },
  evmVersion: 'paris',
  metadata: { bytecodeHash: 'ipfs', useLiteralContent: true },
  outputSelection: {
    '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'metadata'] },
  },
};
const input = {
  language: 'Solidity',
  sources: { [sourceName]: { content: source } },
  settings,
};

function resolveImport(importPath) {
  if (!importPath.startsWith('@openzeppelin/contracts/')) {
    return { error: `Unsupported import: ${importPath}` };
  }
  try {
    const resolved = require.resolve(importPath, { paths: [root] });
    return { contents: fs.readFileSync(resolved, 'utf8') };
  } catch (error) {
    return { error: `Cannot resolve ${importPath}: ${error.message}` };
  }
}

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: resolveImport }));
for (const diagnostic of output.errors || []) {
  process.stderr.write(`${diagnostic.formattedMessage || diagnostic.message}\n`);
}
if ((output.errors || []).some((diagnostic) => diagnostic.severity === 'error')) {
  process.exitCode = 1;
} else {
  const compiled = output.contracts?.[sourceName]?.[contractName];
  if (!compiled?.evm?.bytecode?.object) {
    throw new Error('Compilation produced no deployment bytecode.');
  }
  const artifact = {
    schemaVersion: 1,
    contractName,
    sourceName,
    abi: compiled.abi,
    bytecode: `0x${compiled.evm.bytecode.object}`,
    deployedBytecode: `0x${compiled.evm.deployedBytecode.object}`,
    buildMetadata: {
      compiler: { name: 'solc', version: solc.version() },
      settings,
      sourceSha256: crypto.createHash('sha256').update(source).digest('hex'),
      creationBytecodeSha256: crypto.createHash('sha256')
        .update(Buffer.from(compiled.evm.bytecode.object, 'hex')).digest('hex'),
      solidityMetadata: JSON.parse(compiled.metadata),
    },
  };
  const destination = path.join(root, 'forge', 'artifact.json');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  process.stdout.write(`Compiled ${contractName} with ${solc.version()} -> forge/artifact.json\n`);
}
