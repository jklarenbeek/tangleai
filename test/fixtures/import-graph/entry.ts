import { compileMessageTemplate } from '@jarenjs/core/message';
import { greeting } from './helper.ts';

export const message = compileMessageTemplate(greeting);
