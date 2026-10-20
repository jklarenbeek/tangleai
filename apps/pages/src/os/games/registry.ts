/**
 * The arcade's shelf: every game the studio hosts, by id, in the order
 * the shelf shows them. A game is a `GameModule` (`./game.ts`) and
 * nothing more — the arcade, its HUD and the contract's `arcade.tool`
 * reach a game only through that shape.
 */

import { grove } from './grove/index.ts';
import { dancers } from './dancers/index.ts';
import { arena } from './arena/index.ts';
import type { GameModule } from './game.ts';

export const GAMES: Readonly<Record<string, GameModule>> = Object.freeze({ grove, dancers, arena });
