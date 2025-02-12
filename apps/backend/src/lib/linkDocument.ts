import { htmlToText } from 'html-to-text';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { Document } from '@langchain/core/documents';
import { compressMarkdown, logger } from '@tangleai/utils';

async function pdfParse(buffer) {
  return { text: "" };
}

export const getDocumentsFromLinks = async ({ links }: { links: string[] }) => {
  const splitter = new RecursiveCharacterTextSplitter();

  let docs: Document[] = [];

  await Promise.all(
    links.map(async (link) => {
      link = link.startsWith('http://') || link.startsWith('https://')
        ? link
        : `https://${link}`;

      try {
        
        const response = await fetch(link);
        if (!response.ok)
          throw new Error(`Error ${response.status} fetching: ${link}`);
        
        const buffer = Buffer.from(await response.arrayBuffer());
    
        const isPdf = response.headers['content-type'] === 'application/pdf';

        if (isPdf) {
          const pdfText = await pdfParse(buffer);
          const content = compressMarkdown(pdfText.text);

          const splittedText = await splitter.splitText(content);
          const title = 'PDF Document';

          const linkDocs = splittedText.map((text) => {
            return new Document({
              pageContent: text,
              metadata: {
                title: title,
                url: link,
              },
            });
          });

          docs.push(...linkDocs);
          return;
        }

        const parsedText = htmlToText(buffer.toString('utf8'), {
          selectors: [
            {
              selector: 'a',
              options: {
                ignoreHref: true,
              },
            },
          ],
        })
          .replace(/(\r\n|\n|\r)/gm, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        const splittedText = await splitter.splitText(parsedText);
        const title = buffer.toString('utf8')
          .match(/<title>(.*?)<\/title>/)?.[1];

        const linkDocs = splittedText.map((text) => {
          return new Document({
            pageContent: text,
            metadata: {
              title: title || link,
              url: link,
            },
          });
        });

        docs.push(...linkDocs);
      } catch (err) {
        logger.error(
          `Error at generating documents from links: ${err.message}`,
        );
        docs.push(
          new Document({
            pageContent: `Failed to retrieve content from the link: ${err.message}`,
            metadata: {
              title: 'Failed to retrieve content',
              url: link,
            },
          }),
        );
      }
    }),
  );

  return docs;
};
