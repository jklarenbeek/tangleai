import { Document } from '@langchain/core/documents';

export interface ProgressCallbackProps {
  id?: string;
  count?: number;
  source?: Document;
  error?: Error;
  suggestions?: string[];
  duration?: number; // in milliseconds
  
  sources?: Document[];
  document?: Document[];
  results?: Document[];
}

export type ProgressCallback = (action: string, props?: ProgressCallbackProps) => void
