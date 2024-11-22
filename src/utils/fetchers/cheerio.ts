import { load } from 'cheerio'

export function sanitizeHtml(html: string, selector?: string) {
    const $ = load(html)

    if (selector) {
        const selectedHtml = $(selector).html()

        if (!selectedHtml || !selectedHtml.trim()) {
            throw new Error(`No content found for selector: ${selector}`)
        }

        return selectedHtml
    }

    $('script, style, path, footer, header, head').remove()

    return $.html()
}

