import { spawn } from 'node:child_process';
import path from 'node:path';
import { EnvironmentError, aborted, bounded } from './errors.mjs';

const OUTPUT_LIMIT = 1024 * 1024;

/** Default non-DSH runner. Inject the Host managed runner when a process-range service is available. */
export async function defaultRunner(executable, args = [], { signal, timeoutMs = 15000, env, cwd, onOutput } = {}) {
  aborted(signal);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false, windowsHide: true, cwd, env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let failure = null;
    let terminating = null;
    let escalation = null;
    const terminate = () => {
      if (terminating) return terminating;
      if (!child.pid) return Promise.resolve();
      if (process.platform === 'win32') {
        const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
        const taskkill = path.win32.join(systemRoot, 'System32', 'taskkill.exe');
        terminating = new Promise(done => {
          let killer;
          try {
            killer = spawn(taskkill, ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
          } catch { try { child.kill(); } catch {} done(); return; }
          killer.once('error', () => { try { child.kill(); } catch {} });
          killer.once('close', done);
        });
      } else {
        try { process.kill(-child.pid, 'SIGTERM'); } catch {}
        escalation = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 1000);
        terminating = Promise.resolve();
      }
      return terminating;
    };
    const abort = () => {
      failure ||= new EnvironmentError(signal?.reason?.code === 'runtime_timeout' ? 'runtime_timeout' : 'cancelled', 'Runtime subprocess was cancelled.');
      void terminate();
    };
    const timer = setTimeout(() => {
      failure ||= new EnvironmentError('runtime_process_timeout', 'Runtime subprocess exceeded its deadline.');
      void terminate();
    }, timeoutMs);
    const output = (stream, chunk) => {
      const text = chunk.toString('utf8');
      const current = stream === 'stdout' ? stdout : stderr;
      if (Buffer.byteLength(current) + chunk.length > OUTPUT_LIMIT) {
        failure ||= new EnvironmentError('runtime_output_limit', 'Runtime subprocess output exceeded 1 MiB.');
        void terminate();
        return;
      }
      if (stream === 'stdout') stdout += text; else stderr += text;
      try { onOutput?.(stream, bounded(text, 4096)); } catch {}
    };
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', chunk => output('stdout', chunk));
    child.stderr.on('data', chunk => output('stderr', chunk));
    child.once('error', error => { failure ||= new EnvironmentError('runtime_process_error', bounded(error.message)); });
    child.once('close', async code => {
      clearTimeout(timer);
      if (escalation) clearTimeout(escalation);
      signal?.removeEventListener('abort', abort);
      await terminating;
      if (failure) reject(failure);
      else resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
    if (signal?.aborted) abort();
  });
}
