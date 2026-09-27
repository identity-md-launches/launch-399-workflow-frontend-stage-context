import { useEffect, useState } from 'react';
import { loadDeployment, type Deployment } from '../deployment';

export type DeploymentLoad = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; deployment: Deployment };

export function useDeployment(): DeploymentLoad {
  const [load, setLoad] = useState<DeploymentLoad>({ state: 'loading' });
  useEffect(() => {
    let cancelled = false;
    loadDeployment()
      .then((deployment) => !cancelled && setLoad({ state: 'ready', deployment }))
      .catch((e: Error) => !cancelled && setLoad({ state: 'error', message: e.message }));
    return () => {
      cancelled = true;
    };
  }, []);
  return load;
}
