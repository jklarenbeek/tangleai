import { LinqBuildError as JarenLinqBuildError } from '@jarenjs/linq';

/** Constructor contract implemented by Jaren 0.84.3; its declaration currently inherits Error's signature. */
export const LinqBuildError = JarenLinqBuildError as unknown as {
  new(code: string, reason: string, docPath?: string, cause?: Error): JarenLinqBuildError;
};

export type LinqBuildError = JarenLinqBuildError;
