#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runAuth, runStart, runStop } from './commands.js';
import { loadConfig } from './config.js';
import { emitContract } from './output.js';
import { DevContractError } from './types.js';

const HELP = `dev-contract — standardized dev environment contract (ready = verified login)

Usage:
  dev-contract start [options]   Start convex dev + app dev, provision dev
                                 env vars, and only report ready after a
                                 dev login demonstrably worked. Emits the
                                 contract JSON as the last stdout line.
  dev-contract auth [options]    Mint a fresh VERIFIED session against the
                                 running environment (login URL + cookies).
  dev-contract stop [options]    Stop the processes started by "start".

Options:
  --config <path>   Config file (default: devcontract.config.{json,mjs,js})
  --email <email>   Override the dev user email from the config
  --out <path>      Additionally write the result JSON to a file
  --root <path>     Project root (default: current working directory)
  -h, --help        Show this help
  --version         Show the package version

All logging goes to stderr; stdout is reserved for the final JSON line.
Exit code 0 means the JSON was emitted AND (for start/auth) the login was
verified — never trust "ready" from any other signal.
`;

function packageVersion(): string {
  try {
    const packageJsonPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../package.json',
    );
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      version?: string;
    };
    return parsed.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: 'string' },
      email: { type: 'string' },
      out: { type: 'string' },
      root: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean' },
    },
  });

  if (values.version) {
    process.stdout.write(`${packageVersion()}\n`);
    return 0;
  }
  const command = positionals[0];
  if (values.help || !command) {
    process.stdout.write(HELP);
    return values.help ? 0 : 1;
  }
  if (!['start', 'auth', 'stop'].includes(command)) {
    process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
    return 1;
  }

  const root = path.resolve(values.root ?? process.cwd());
  const config = await loadConfig(root, values.config);
  const options = values.email ? { email: values.email } : undefined;

  if (command === 'start') {
    emitContract(await runStart(config, options), values.out);
  } else if (command === 'auth') {
    emitContract(await runAuth(config, options), values.out);
  } else {
    emitContract(await runStop(config), values.out);
  }
  return 0;
}

main().then(
  code => process.exit(code),
  (error: unknown) => {
    if (error instanceof DevContractError) {
      process.stderr.write(`dev-contract failed ${error.message}\n`);
    } else {
      process.stderr.write(`dev-contract failed: ${String(error)}\n`);
      if (error instanceof Error && error.stack) {
        process.stderr.write(`${error.stack}\n`);
      }
    }
    process.exit(1);
  },
);
