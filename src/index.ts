// Programmatic surface: everything the CLI does, plus the pure building
// blocks (config resolution, guard, login flow) for consumers that embed
// the contract instead of shelling out.

export { runAuth, runSeed, runStart, runStop } from './commands.js';
export { CONFIG_FILE_CANDIDATES, loadConfig, resolveConfig } from './config.js';
export {
  buildCookieHeader,
  findAuthCookies,
  parseSetCookies,
  type ParsedCookie,
} from './cookies.js';
export {
  convexEnvSet,
  convexEnvSnapshot,
  mintDevToken,
  parseConvexRunJson,
  runConvexFunction,
} from './convexRun.js';
export { parseEnvFile, readProjectEnvValue } from './envFile.js';
export {
  assertProvisioningAllowed,
  checkProvisioningAllowed,
  type DeploymentGuardInput,
  type DeploymentGuardResult,
} from './guard.js';
export {
  buildVerifyUrl,
  performLogin,
  type LoginDeps,
  type LoginTarget,
} from './login.js';
export { buildAuthOutput, buildStartOutput, emitContract } from './output.js';
export { waitFor, type WaitOptions } from './readiness.js';
export { performSeed } from './seed.js';
export {
  DevContractError,
  type AuthOutput,
  type AuthState,
  type ContractStep,
  type DevContractConfig,
  type ResolvedDevContractConfig,
  type SeedOutput,
  type StartOutput,
} from './types.js';
