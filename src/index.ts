export interface ApplicationInfo {
  name: 'output-pulse';
  runtime: 'node';
}

export function createApplicationInfo(): ApplicationInfo {
  return {
    name: 'output-pulse',
    runtime: 'node',
  };
}
