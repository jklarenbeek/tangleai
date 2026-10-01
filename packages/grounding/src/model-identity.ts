import { identityIdOf, validateRunIdentity } from '@tangleai/config';
import { groundingReject } from './errors.ts';
export async function checkGroundingModelIdentity(value: unknown, path: string) {
    if (value === null) return;
    const shape = validateRunIdentity(value);
    if (!shape.ok) groundingReject('TGRD1002', path + (shape.issues[0]?.path ?? ''), 'Invalid configuration identity.', shape.issues[0]);
    const { identityId, ...payload } = shape.value;
    if (identityId !== await identityIdOf(payload)) groundingReject('TGRD1002', path + '/identityId', 'Configuration identity differs from its canonical payload.');
}
