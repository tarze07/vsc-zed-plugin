import * as fs from 'fs';

/**
 * Best-effort removal of a temporary test directory. On Windows runners the directory can stay
 * locked (EPERM/EBUSY) for a while after git processes exit; leaving it behind in the temp folder
 * is harmless, so cleanup must not fail the test.
 */
export function removeTmpDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform === 'win32' && (code === 'EPERM' || code === 'EBUSY')) {
      console.warn(`[test] could not remove ${dir} (${code}); leaving it in the temp folder`);
      return;
    }
    throw error;
  }
}
