export class EnvironmentError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'EnvironmentError';
    this.code = code;
    this.details = details;
  }
}

export class EnvironmentNotReadyError extends EnvironmentError {
  constructor(message = 'A ready private Python environment is not available.') {
    super('environment_not_ready', message);
    this.name = 'EnvironmentNotReadyError';
  }
}

export function aborted(signal) {
  if (signal?.aborted) throw new EnvironmentError(signal.reason?.code === 'runtime_timeout' ? 'runtime_timeout' : 'cancelled', signal.reason?.code === 'runtime_timeout' ? 'Runtime preparation exceeded its deadline.' : 'Runtime preparation was cancelled.');
}

export function bounded(value, limit = 512) {
  const text = String(value ?? '');
  return text.length > limit ? text.slice(0, limit) + '…' : text;
}

export function normalize(error, signal, fallback = 'environment_failed') {
  if (signal?.aborted) {
    try { aborted(signal); } catch (failure) { return failure; }
  }
  if (error instanceof EnvironmentError) return error;
  if (error?.name === 'AbortError') return new EnvironmentError('cancelled', 'Runtime preparation was cancelled.');
  return new EnvironmentError(fallback, bounded(error?.message || error || 'Runtime preparation failed.'));
}
