import { START_LOCATION } from './gameContent.js';
export function createGameState() { return {
      started: false,           // false → the title card (name your pirate)
      nameForm: { name: '' },   // the @jarenjs/forms name field data
      locale: 'en',             // validation-message locale (@jarenjs/locales)
      room: { current: START_LOCATION },   // the scene FSM's slice
      verb: 'look',             // the armed point-and-click verb
      held: null,               // the armed inventory item (use/give/combine)
      inv: [],                  // item ids held
      forms: [],                // the "admiralty forms in triplicate" running gag (exports to CSV)
      flags: {},                // solved_<puzzle> / clue_* / gag_* flags
      log: [],                  // the narration feed ({ kind, text })
      dialogue: null,           // { who, node } while talking
      duel: null,               // { poise, landed, insult, known[] } during the insult sword-fight
      ask: '',                  // the dynamic-tier free-text question
      thinking: false,          // an NPC is answering live
      won: false,
    }; }
