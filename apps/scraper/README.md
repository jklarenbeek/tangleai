# TangleAI Scraper App

This app / container can fetch a HTML document or PDF document from the internet and return it as a fully formatted markdown document.

It depends on searxng, which in turn depends on a redis storage backend.

## TODO

Integrate the search option that is now present in the tangleai backend app, fetch all documents from the search and return a list of results in markdown format. 

## Development

First start the searxng container by executing the following command at the root of the tangleai workspace:

```sh
docker compose up -d
```

Then start the development server of the tangleai app package by executing the command from the root of the tangleai workspace:

```sh
npm run dev --workspace @tangleai/scraper
```

### Testing

please use the `testme.http` file in order to query the api of searxng and the scraper.

