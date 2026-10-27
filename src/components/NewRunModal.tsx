import React from 'react';
import { WorkflowType, KaggleKernelSummary } from '../types/chronos.ts';
import { X } from 'lucide-react';

interface NewRunModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => Promise<void>;
  newRunName: string;
  setNewRunName: (v: string) => void;
  newRunWorkflow: WorkflowType;
  setNewRunWorkflow: (v: WorkflowType) => void;
  newRunKernel: string;
  setNewRunKernel: (v: string) => void;
  newRunObjective: string;
  setNewRunObjective: (v: string) => void;
  discoveredKernels: KaggleKernelSummary[];
  busyAction: string | null;
}

export const NewRunModal: React.FC<NewRunModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  newRunName,
  setNewRunName,
  newRunWorkflow,
  setNewRunWorkflow,
  newRunKernel,
  setNewRunKernel,
  newRunObjective,
  setNewRunObjective,
  discoveredKernels,
  busyAction,
}) => {
  if (!isOpen) return null;

  const kernelOptions =
    discoveredKernels.length > 0
      ? discoveredKernels
      : [
          {
            ref: 'raviikishore07/project-zero-ram-fdtd-gpu',
            title: 'Project Zero RAM FDTD GPU',
            lastRunTime: '',
          },
          {
            ref: 'raviikishore07/kaggle-v7-production-t4',
            title: 'Kaggle V7 Production T4',
            lastRunTime: '',
          },
        ];

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div className="bg-[#111827] border border-slate-800 rounded-lg max-w-lg w-full p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h2 className="text-base font-semibold text-slate-100">
            Launch New Durable Agent Thread
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-slate-300 mb-1">Thread Name</label>
            <input
              type="text"
              required
              value={newRunName}
              onChange={(e) => setNewRunName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-300 mb-1">Workflow Type</label>
              <select
                value={newRunWorkflow}
                onChange={(e) => setNewRunWorkflow(e.target.value as WorkflowType)}
                className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
              >
                <option value={WorkflowType.KAGGLE_RECONCILIATION}>
                  Kaggle GPU Reconciliation
                </option>
                <option value={WorkflowType.CODE_SANDBOX_AGENT}>Isolated Code Sandbox Agent</option>
                <option value={WorkflowType.CRON_DEPENDENCY_AUDIT}>
                  Scheduled Cron Reconciler
                </option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-300 mb-1">Kaggle GPU Kernel Slug</label>
              <select
                value={newRunKernel}
                onChange={(e) => setNewRunKernel(e.target.value)}
                disabled={newRunWorkflow !== WorkflowType.KAGGLE_RECONCILIATION}
                className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-xs font-mono text-slate-200 disabled:opacity-40 focus:outline-none focus:border-blue-500"
              >
                {kernelOptions.map((k) => (
                  <option key={k.ref} value={k.ref}>
                    {k.ref}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-300 mb-1">
              Durable Agent Objective (Executed via Server-Side Gemini 3.8 Flash)
            </label>
            <textarea
              rows={3}
              required
              value={newRunObjective}
              onChange={(e) => setNewRunObjective(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-md"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busyAction !== null}
              className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md"
            >
              {busyAction === 'create_run'
                ? 'Initializing Checkpoint...'
                : 'Dispatch Durable Thread'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
