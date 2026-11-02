import { z } from 'zod';

// Hand-authored against DSH rc.5 InvocationDescriptor / TypertContribution.
// The Client embeds this package's own descriptor, never a Harness UI module.
export const IOS_ENVIRONMENT_PACKAGE = 'dsh-ios-webview-app-control';
export const IOS_ENVIRONMENT_SERVICE = 'iosEnvironment';
export const ENVIRONMENT_PHASES = Object.freeze([
  'unprepared', 'checking', 'downloading', 'creating', 'installing', 'verifying',
  'ready', 'failed', 'cancelled',
]);

export const EnvironmentSnapshotSchema = z.strictObject({
  phase: z.enum(ENVIRONMENT_PHASES),
  busy: z.boolean(),
  step: z.string().max(256),
  progress: z.strictObject({
    completedBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    totalBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  }).nullable().optional(),
  python: z.strictObject({
    path: z.string().max(8192),
    version: z.string().max(128),
    source: z.enum(['host', 'private']),
    abi: z.string().max(128).optional(),
  }).nullable().optional(),
  runtimeDir: z.string().max(8192).optional(),
  pymobiledevice3: z.string().max(128).optional(),
  error: z.strictObject({
    code: z.string().max(128),
    message: z.string().max(2048),
  }).nullable().optional(),
});

/** Only named public environment fields cross the Remote boundary. */
export function projectEnvironmentSnapshot(raw) {
  const snapshot = { phase: raw?.phase, busy: raw?.busy, step: raw?.step ?? raw?.phase };
  if (raw?.progress === null) snapshot.progress = null;
  else if (raw?.progress !== undefined) {
    snapshot.progress = { completedBytes: raw.progress.completedBytes };
    if (raw.progress.totalBytes !== undefined) snapshot.progress.totalBytes = raw.progress.totalBytes;
  }
  if (raw?.python === null) snapshot.python = null;
  else if (raw?.python !== undefined) {
    snapshot.python = { path: raw.python.path, version: raw.python.version, source: raw.python.source };
    if (raw.python.abi !== undefined) snapshot.python.abi = raw.python.abi;
  }
  for (const key of ['runtimeDir', 'pymobiledevice3']) {
    if (raw?.[key] !== undefined) snapshot[key] = raw[key];
  }
  if (raw?.error === null) snapshot.error = null;
  else if (raw?.error !== undefined) snapshot.error = { code: raw.error.code, message: raw.error.message };
  return EnvironmentSnapshotSchema.parse(snapshot);
}

export const environmentSnapshotCodec = Object.freeze({
  mode: 'strict',
  typeSymbol: `${IOS_ENVIRONMENT_PACKAGE}#EnvironmentSnapshot`,
  create: () => EnvironmentSnapshotSchema,
  // Gateway does not parse Host results itself; enforce the output boundary too.
  encode: value => EnvironmentSnapshotSchema.parse(value),
  decode: value => EnvironmentSnapshotSchema.parse(value),
});

export const environmentInvocations = Object.freeze(
  ['status', 'prepare', 'cancel', 'cleanup', 'follow'].map(method => Object.freeze({
    id: `${IOS_ENVIRONMENT_PACKAGE}#${IOS_ENVIRONMENT_SERVICE}/${method}`,
    service: IOS_ENVIRONMENT_SERVICE,
    namespace: IOS_ENVIRONMENT_SERVICE,
    method,
    invocation: Object.freeze({ kind: 'direct' }),
    parameters: Object.freeze([]),
    cancellation: Object.freeze({ parameter: 'signal' }),
    ...(method === 'follow' ? { mode: 'stream' } : {}),
    result: environmentSnapshotCodec,
  })),
);

export const environmentHostContribution = Object.freeze({
  package: IOS_ENVIRONMENT_PACKAGE,
  face: 'host',
  schemas: Object.freeze([{ name: 'EnvironmentSnapshot', create: () => EnvironmentSnapshotSchema }]),
  model: Object.freeze({
    services: [{
      key: IOS_ENVIRONMENT_SERVICE,
      exportName: 'IosEnvironmentService',
      description: 'Host-owned Python environment preparation; never contacts a phone.',
      tags: [],
      members: environmentInvocations.map(({ method }) => ({
        kind: 'method', name: method,
        signature: method === 'follow'
          ? 'follow(signal: AbortSignal): AsyncIterable<EnvironmentSnapshot>'
          : `${method}(signal: AbortSignal): Promise<EnvironmentSnapshot>`,
      })),
      types: [{
        name: 'EnvironmentSnapshot',
        declaration: 'export interface EnvironmentSnapshot { readonly phase: "unprepared" | "checking" | "downloading" | "creating" | "installing" | "verifying" | "ready" | "failed" | "cancelled"; readonly busy: boolean; readonly step: string; readonly progress?: { readonly completedBytes: number; readonly totalBytes?: number } | null; readonly python?: { readonly path: string; readonly version: string; readonly source: "host" | "private"; readonly abi?: string } | null; readonly runtimeDir?: string; readonly pymobiledevice3?: string; readonly error?: { readonly code: string; readonly message: string } | null; }',
      }],
    }],
    objects: [],
    events: [],
  }),
  invocations: environmentInvocations,
});
