/** Authored protocol pages. No relevance labels participate in their construction. */
import type { LiteratureRecord, ResearchTranscript } from '@tangleai/research';

export function researchDiscoveryTranscripts(literature: readonly LiteratureRecord[]): Map<string, ResearchTranscript> {
  const entries = new Map<string, ResearchTranscript>();
  const put = (path: string, url: string, body: unknown, mime = 'application/json', status = 200, headers: Record<string, string> = {}, requestHeaders?: Record<string, string>) => {
    entries.set('literature/transcripts/paged/' + path + '.json', { method: 'GET', url, ...(requestHeaders ? { headers: requestHeaders } : {}), body: null,
      response: { status, headers: { 'content-type': mime, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) } });
  };
  const url = (base: string, params: Record<string, string | number>) => {
    const result = new URL(base); for (const [key, value] of Object.entries(params)) result.searchParams.set(key, String(value)); return result.href;
  };
  const topicIds = [...new Set(literature.map(row => row.id.split('-paper-')[0]))];
  for (const topic of topicIds) {
    const rows = literature.filter(row => row.id.startsWith(topic + '-paper-'));
    for (const [page, start] of [0, 5, 8].entries()) {
      const selected = rows.slice(start, start + 5), cursor = page === 0 ? '*' : 'page-' + start;
      put(topic + '/openalex-' + page, url('https://api.openalex.org/works', { per_page: 5, search: topic, cursor }),
        { meta: { count: rows.length, next_cursor: start === 8 ? null : 'page-' + Math.min(rows.length, start + 5) },
          results: selected.map(row => ({ id: 'https://openalex.org/W' + (10000 + literature.indexOf(row)), doi: 'https://doi.org/' + row.canonicalIds.doi,
            display_name: row.title, publication_date: row.date, authorships: row.authors.map(name => ({ author: { display_name: name } })),
            primary_location: { landing_page_url: 'https://fixture.invalid/' + row.sourcePath } })) });
      if (start === 8) continue;
      put(topic + '/crossref-' + page, url('https://api.crossref.org/works', { query: topic, rows: 5, cursor }),
        { status: 'ok', message: { 'total-results': rows.length, 'next-cursor': 'page-' + (start + 5), items: selected.map(row => ({
          DOI: row.canonicalIds.doi, title: [row.title], author: row.authors.map(name => ({ name })), published: { 'date-parts': [[2026, 1, 1]] },
          resource: { primary: { URL: 'https://fixture.invalid/' + row.sourcePath } } })) } });
      put(topic + '/semanticscholar-' + page, url('https://api.semanticscholar.org/graph/v1/paper/search', {
        fields: 'title,authors,publicationDate,externalIds,url,openAccessPdf', limit: 5, query: topic, offset: start }),
        { total: rows.length, offset: start, ...(start === 0 ? { next: 5 } : {}), data: selected.map(row => ({ paperId: 'synthetic-' + literature.indexOf(row),
          title: row.title, authors: row.authors.map(name => ({ name })), publicationDate: row.date,
          externalIds: { DOI: row.canonicalIds.doi, ArXiv: row.canonicalIds.arxiv }, url: 'https://fixture.invalid/' + row.sourcePath })) });
      put(topic + '/arxiv-' + page, url('https://export.arxiv.org/api/query', { search_query: topic, start, max_results: 5 }),
        '<feed xmlns="http://www.w3.org/2005/Atom" xmlns:a="http://arxiv.org/schemas/atom" xmlns:o="http://a9.com/-/spec/opensearch/1.1/">'
        + '<o:totalResults>' + rows.length + '</o:totalResults><o:startIndex>' + start + '</o:startIndex><o:itemsPerPage>5</o:itemsPerPage>'
        + selected.map(row => '<entry><id>https://arxiv.org/abs/' + row.canonicalIds.arxiv + 'v2</id><title>' + row.title + '</title>'
          + row.authors.map(name => '<author><name>' + name + '</name></author>').join('')
          + '<published>2026-01-01T00:00:00Z</published><updated>2026-01-02T00:00:00Z</updated><a:doi>' + row.canonicalIds.doi
          + '</a:doi><a:primary_category term="cs.AI"/><link rel="related" href="https://fixture.invalid/' + row.sourcePath + '"/></entry>').join('') + '</feed>', 'application/atom+xml');
    }
    for (const page of [1, 2]) put(topic + '/searxng-' + page,
      url('https://search.fixture.invalid/search', { format: 'json', q: topic, pageno: page }),
      { results: page === 1 ? [{ title: 'Unverified search snippet', url: 'https://fixture.invalid/proposal', content: 'A snippet is not supporting evidence.' }] : [], suggestions: [] },
      'application/json', 200, {}, { accept: 'application/json' });
  }
  const crossref = (query: string) => url('https://api.crossref.org/works', { query, rows: 5, cursor: '*' });
  put('failures/rate-limited', crossref('rate-limited'), { message: 'synthetic rate limit' }, 'application/json', 429, { 'retry-after': '1' });
  put('failures/server-error', crossref('server-error'), { message: 'synthetic failure' }, 'application/json', 500);
  put('failures/malformed-json', crossref('malformed-json'), '{"message":', 'application/json');
  put('failures/malformed-atom', url('https://export.arxiv.org/api/query', { search_query: 'malformed-atom', start: 0, max_results: 5 }), '<feed><entry></feed>', 'application/atom+xml');
  put('collisions/distinct-title', crossref('distinct-title'), { message: { items: ['a', 'b'].map(suffix => ({ DOI: '10.5555/distinct-' + suffix,
    title: ['Identical normalized title'], author: [{ name: 'Fixture Author' }], published: { 'date-parts': [[2026, 1, 1]] },
    URL: 'https://fixture.invalid/' + suffix })) } });
  return entries;
}
