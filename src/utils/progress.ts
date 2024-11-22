import { Document } from '@langchain/core/documents';

export interface ProgressCallbackProps {
  sources?: Document[];
  source?: Document;
  id?: string;
  error?: Error;
  count?: number;
  suggestions?: string[];
  document?: Document[];
  results?: Document[];
}

export type ProgressCallback = (action: string, props?: ProgressCallbackProps) => void
