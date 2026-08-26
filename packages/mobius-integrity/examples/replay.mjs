#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { printReplay, replayPacket } from '../packet/replayPacket.js';

const packetPath = process.argv[2];
if (!packetPath) {
  console.error('Usage: node packages/mobius-integrity/examples/replay.mjs <packet.json>');
  process.exitCode = 2;
} else {
  try {
    const json = await readFile(path.resolve(packetPath), 'utf8');
    const result = await replayPacket(json);
    printReplay(result);
    if (!result.valid) process.exitCode = 1;
  } catch (error) {
    console.error(`[EPICON] Replay failed: ${error.message}`);
    process.exitCode = 1;
  }
}
