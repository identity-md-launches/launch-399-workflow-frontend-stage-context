import type { Step } from '../lib/tx';
import { explorerTx, shortHash } from '../lib/format';

const MARK: Record<Step['state'], string> = { pending: '○', active: '…', done: '✓', failed: '✕', skipped: '–' };
const WORD: Record<Step['state'], string> = { pending: 'Pending', active: 'In progress', done: 'Done', failed: 'Failed', skipped: 'Skipped' };

export function Steps({ steps, explorer }: { steps: Step[]; explorer: string }) {
  if (steps.length === 0) return null;
  return (
    <ol className="steps" aria-label="Transaction steps">
      {steps.map((step, i) => (
        <li key={step.id}>
          <span className="marker" aria-hidden="true">
            {step.state === 'pending' ? i + 1 : MARK[step.state]}
          </span>
          <span>
            <strong>{step.label}</strong> <span className="muted">· {WORD[step.state]}</span>
            {step.detail ? <span className={step.state === 'failed' ? ' error' : ''}> — {step.detail}</span> : null}
            {step.hash ? (
              <>
                {' '}
                <a href={explorerTx(explorer, step.hash)} target="_blank" rel="noreferrer">
                  View transaction {shortHash(step.hash)}
                </a>
              </>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
