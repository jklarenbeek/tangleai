import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";

console.log("CheerioLoader");

const loader = new CheerioWebBaseLoader(
  "https://en.wikipedia.org/wiki/Amsterdam",
  {
    // optional params: ...
  }
);

const docs = await loader.load();

console.log(docs[0]);
