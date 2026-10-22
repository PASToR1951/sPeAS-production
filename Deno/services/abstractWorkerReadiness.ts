export interface AbstractWorkerState {
  last_heartbeat_at: string | Date | null;
  dependencies_ready: boolean;
  dependency_error_code: string | null;
  dependencies_checked_at: string | Date | null;
}

export function abstractWorkerDiagnostics(state?: AbstractWorkerState, now = Date.now()) {
  const fresh = (value: string | Date | null | undefined, maxAge = 120_000) => {
    const age = now - new Date(value ?? "").getTime();
    return Number.isFinite(age) && age >= 0 && age < maxAge;
  };
  const workerAvailable = fresh(state?.last_heartbeat_at);
  return {
    workerAvailable,
    extractionReady: workerAvailable && state?.dependencies_ready === true && fresh(state.dependencies_checked_at, 600_000),
    errorCode: workerAvailable ? state?.dependency_error_code ?? null : "ABSTRACT_WORKER_OFFLINE",
    checkedAt: state?.dependencies_checked_at ?? null,
  };
}

export function dependencyErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return message.startsWith("ABSTRACT_OCR_LANGUAGE_UNAVAILABLE")
    ? "ABSTRACT_OCR_LANGUAGE_UNAVAILABLE"
    : "ABSTRACT_DEPENDENCY_UNAVAILABLE";
}

export function isDependencyFailure(code: string): boolean {
  return /(?:PDFINFO|PDFTOTEXT|PDFTOPPM|TESSERACT)_UNAVAILABLE|ABSTRACT_DEPENDENCY_UNAVAILABLE|ABSTRACT_OCR_LANGUAGE_UNAVAILABLE|COMMAND_START_FAILED/u.test(code);
}
