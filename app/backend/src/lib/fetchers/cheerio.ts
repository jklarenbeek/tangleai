import { CheerioAPI, load } from 'cheerio'
import XXH from 'xxhashjs';
import { isEmpty } from '../../utils/tools';
import { Element } from 'domhandler';

interface LinkRef {
  type: string,
  cid: string,
  ref: string,
}

function linkify($:CheerioAPI, select: string, attrName: string) {
  const links: LinkRef[] = [];

  $(select).each((idx, el) => {
    const ref = $(el).attr(attrName);
    if (!isEmpty(ref)) {
      const link = {
        type: `${select}:${attrName}`,
        cid: XXH.h64(ref, 0xABCD).toString(16),
        ref: ref
      }
      $(el).attr(attrName, `cid://${link.cid}`);
      links.push(link);
    }
  });

  return links;
}

export function sanitizeHtml(html: string, selector?: string) {
  const $ = load(html)

  $('script, style, path, footer, header, head').remove()

  const links: LinkRef[] = [];

  links.push(...linkify($,"a", "href"));
  links.push(...linkify($, "img", "src"));

  if (selector) {
    const selectedHtml = $(selector).html()
    if (!selectedHtml || !selectedHtml.trim()) {
      throw new Error(`No content found for selector: ${selector}`)
    }
    return { html: selectedHtml, links }
  }

  return { html: $.html(), links }
}

