/** Move schema resource addresses into the desktop's self-contained contract. */
export function contractSchemaResource(value:unknown,prefix:string,externals:Readonly<Record<string,string>>={}):any{
    if(Array.isArray(value))return value.map(item=>contractSchemaResource(item,prefix,externals));
    if(!value||typeof value!=='object')return value;
    return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='$id'&&key!=='$schema').map(([key,item])=>{
        if(key==='$ref'&&typeof item==='string'){
            if(item.startsWith('#/'))return [key,prefix+item.slice(1)];
            if(Object.hasOwn(externals,item))return [key,externals[item]];
            throw new TypeError('Unregistered desktop schema reference: '+item);
        }
        return [key,contractSchemaResource(item,prefix,externals)];
    }));
}
