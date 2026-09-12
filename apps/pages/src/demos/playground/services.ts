/** Pages supplies rendering and operator policy to public engine components. */
import { createMdComponent } from '@jarenjs/md/component';
import { highlightPlugin } from '@jarenjs/md/plugins';
import { mermaidPlugin } from '@jarenjs/mermaid/plugin';
import { createMermaidComponent } from '@jarenjs/mermaid/component';
import { createStudioDocumentHost, createProjectHost } from '@jarenjs/studio/component';
import { operatorRegistry, runQuery, runJslt } from './engines.ts';
import { runValidation } from './validator.ts';
import { STUDIO_TEMPLATES } from './appTemplates.ts';
export { operatorRegistry, runQuery, runJslt } from './engines.ts';
export { runValidation, localizeErrors, formViewFor } from './validator.ts';
export { chartRenderer } from './charts.ts';
export { formatJson } from './format.ts';
export const md = createMdComponent({ plugins: [highlightPlugin(), mermaidPlugin({ theme: 'host' })], headingIds: true });
export const UNTRUSTED = { slugPrefix: 'user-content-' };
export const mdArticle = (vnode: any) => vnode;
export const mermaid = createMermaidComponent({ theme: 'host' });
export const documentHost = createStudioDocumentHost({ markdown: source => md.view(source, UNTRUSTED), diagram: source => mermaid.view(source), templates: STUDIO_TEMPLATES });
export const projectHost = createProjectHost({ operators: operatorRegistry, loadDocument: documentHost.loadStudioDocument, runQuery, runJslt, runValidation });
