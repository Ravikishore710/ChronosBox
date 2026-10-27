import { z } from 'zod';
import { WorkflowType } from '../types/chronos.ts';

export const KagglePollSchema = z.object({
  runId: z.string().min(1).optional(),
  kernelSlug: z.string().min(1).optional(),
});

export const SandboxExecSchema = z.object({
  runId: z.string().min(1, 'runId is required'),
  toolName: z.string().min(1).default('exec_sandbox_bash'),
  command: z.string().min(1, 'command must not be empty'),
  targetFilePath: z.string().optional(),
  ProposedContent: z.string().optional(),
  simulateExitCode: z.number().int().optional(),
});

export const CheckpointResumeSchema = z.object({
  runId: z.string().min(1, 'runId is required'),
  checkpointId: z.string().min(1, 'checkpointId is required'),
  actionType: z.enum(['WEBHOOK_RESUME', 'HUMAN_APPROVAL', 'TIME_TRAVEL_FORK']),
  webhookPayload: z.record(z.string(), z.unknown()).optional(),
});

export const DlqReplaySchema = z.object({
  dlqId: z.string().min(1, 'dlqId is required'),
  patchedCommand: z.string().min(1, 'patchedCommand is required'),
});

export const CreateOrStepRunSchema = z.object({
  runId: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  workflowType: z.nativeEnum(WorkflowType).default(WorkflowType.KAGGLE_RECONCILIATION),
  kaggleKernelSlug: z.string().nullable().optional(),
  objectivePrompt: z.string().min(1, 'objectivePrompt is required'),
});

export const BenchmarkRunSchema = z.object({
  iterations: z.number().int().min(100).max(100000).default(12000),
});
