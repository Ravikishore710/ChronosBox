// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SandboxInspectorView } from './SandboxInspectorView.tsx';
import { stateStore } from '../server/db.ts';

describe('SandboxInspectorView UI Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          polledAt: new Date().toISOString(),
          containers: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });
  });

  it('renders isolated sandbox quotas, CAS Merkle tree, and execution console', () => {
    render(
      <SandboxInspectorView
        runs={stateStore.runs}
        selectedRunId="run_zero_ram_fdtd"
        onSelectRun={() => {}}
        checkpoints={stateStore.checkpoints}
        trajectoryEvents={stateStore.trajectoryEvents}
        onExecuteSandboxCommand={async () => {}}
        busyAction={null}
      />
    );

    expect(
      screen.getByText(/Isolated Sandbox Environment & Copy-on-Write Workspace/i)
    ).toBeDefined();
    expect(screen.getByText(/Allowed Egress Domains/i)).toBeDefined();
    expect(screen.getByText(/Sandbox Command Runner/i)).toBeDefined();
  });
});
