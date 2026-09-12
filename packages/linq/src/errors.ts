import { LinqBuildError as JarenLinqBuildError } from '@jarenjs/linq';

/** The published coded constructor still inherits Error's signature in its declaration. */
export const LinqBuildError = JarenLinqBuildError as unknown as {
  new(code: string, reason: string, docPath?: string, cause?: Error): JarenLinqBuildError;
};

export type LinqBuildError = JarenLinqBuildError;
