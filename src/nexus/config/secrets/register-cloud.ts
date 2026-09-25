// NEXUS · cloud backend auto-register (Phase N-3.5 PR υ)
//
// Called from runNexus boot (after loadAllBuiltins · before
// selectBackendFromConfig). Registers cloud backends with the registry
// so `selectBackendFromConfig()` can flip the active selection without
// any further wiring. Each backend reads its config from UserConfig at
// construction time; they're cheap to register (no SDK loaded until
// first call).

import { registerBackend } from './registry.js';
import { createKeychainBackend } from './keychain-backend.js';
import { createOnePasswordBackend } from './onepassword-backend.js';
import { createAwsBackend } from './aws-backend.js';
import { createGcpBackend } from './gcp-backend.js';
import { readUserConfig, readSwitchValue } from '../user-config.js';

export function registerAllCloudBackends(): void {
  const cfg = readUserConfig();
  const sv = (id: string): string | undefined => {
    const v = readSwitchValue(cfg, id);
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  };

  registerBackend(createKeychainBackend());

  registerBackend(createAwsBackend({
    ...(sv('global.secrets.aws.region') !== undefined ? { region: sv('global.secrets.aws.region')! } : {}),
    ...(sv('global.secrets.aws.kmsKeyId') !== undefined ? { kmsKeyId: sv('global.secrets.aws.kmsKeyId')! } : {}),
    ...(sv('global.secrets.aws.secretPrefix') !== undefined ? { secretPrefix: sv('global.secrets.aws.secretPrefix')! } : {}),
  }));

  registerBackend(createGcpBackend({
    ...(sv('global.secrets.gcp.projectId') !== undefined ? { projectId: sv('global.secrets.gcp.projectId')! } : {}),
    ...(sv('global.secrets.gcp.replication') === 'user-managed' ? { replication: 'user-managed' as const } : { replication: 'automatic' as const }),
  }));

  registerBackend(createOnePasswordBackend({
    vault: sv('global.secrets.1password.vault') ?? '',
    ...(sv('global.secrets.1password.account') !== undefined ? { account: sv('global.secrets.1password.account')! } : {}),
  }));
}
