export function isEmpty(str) {
    return (str == null)
      || str === ''
      || /^\s*$/.test(str);
}

/**
 * Returns null if the input string is empty or null, otherwise returns the input string.
 * 
 * @param {string} str - The input string to check for emptiness.
 * @returns {string | null} - The input string or null.
 */
export function NullIfEmpty(str) {
    return isEmpty(str) ? null : str;
}

export function SplitString(str) {
    const re = /\s*(?:;|$)\s*/;
    return isEmpty(str) ? [] : str.split(re);
}

export function collapseWhitespaces(str) {
  return isEmpty(str)
    ? ''
    : str.replace(/(\r\n|\n|\r)/gm, ' ').replace(/\s+/g, ' ');
}
export function compressMarkdown(content: string) {
  return content.trim()
    .replace(/\r?\n|\r/g, '\n') // set all types of newlines to \n
    .replace(/[\t\v\f]/g, ' ') // reset all white spaces to spaces
    .replace(/ +\n/g, '\n') // trim end of lines
    .replace(/\n{3,}/g, '\n\n') // compress all 3 or more new lines to 2 new lines
    .replace(/\|-+(?=\|)/g, '|-') // compress all table splitters
    .replace(/ +\|/g, '|') // remove white spaces at the beginning of a table
    .replace(/ *-{4,} *\n/g, '---\n'); // remove all white space around a page separator and shink it
}

export function sanitizeUrl(link) {
  if (isEmpty(link))
  return ''; // throw new Error("Document url is empty");

  const url = link.startsWith('http://') || link.startsWith('https://')
      ? link
      : `https://${link}`;
  return url;
}

export function sanitizeContentType(contentType: string) : string {
  return contentType
    .trim()
    .split(';')[0]
    .trim();
}
