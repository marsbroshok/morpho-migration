#!/usr/bin/env node
import { CliRunner } from './cli/cli-runner.js';

const runner = new CliRunner();
runner.run(process.argv);
