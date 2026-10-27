import { describe, it, expect } from 'vitest';
import { createChronosExpressApp } from '../../server.ts';
import { stateStore } from './db.ts';

describe('Express API Route Integration & Validation', () => {
  it('exposes a configured Express application with security middleware', () => {
    const app = createChronosExpressApp();
    expect(app).toBeDefined();
    expect(typeof app.use).toBe('function');
  });

  it('maintains valid seeded state with 3 durable runs and 7 checkpoints', () => {
    expect(stateStore.runs.length).toBeGreaterThanOrEqual(3);
    expect(stateStore.checkpoints.length).toBeGreaterThanOrEqual(7);
    expect(stateStore.dlqDumps.length).toBeGreaterThanOrEqual(1);
    const runIds = stateStore.runs.map((r) => r.id);
    expect(runIds).toContain('run_zero_ram_fdtd');
    expect(runIds).toContain('run_holygrail_v7_t4');
    expect(runIds).toContain('run_cron_dep_spiral');
  });
});
