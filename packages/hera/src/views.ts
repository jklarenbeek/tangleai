/** Model inputs carry readable guidance; vectors remain in the selector's frozen records. */
import type {HeraExperience,HeraProfile} from './contracts.gen.ts';
export const heraProfileView=({text,tags}:HeraProfile)=>({text,tags:[...tags]});
export function heraExperienceView(entry:HeraExperience){
  const {id,scope,insight,provenance,useCount,successCount,utility,selectionCount,parents}=entry;
  return {id,scope,profile:heraProfileView(entry.profile),insight,provenance:structuredClone(provenance),useCount,successCount,utility,selectionCount,parents:[...parents]};
}
