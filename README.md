# RAG - JavaScript

JavaScript port of the RAG (Retrieval-Augmented Generation) assignment using [Ollama](https://ollama.com/).

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Ollama](https://ollama.com/) installed and running locally
- Required Ollama models pulled:
  - `embeddinggemma` (embeddings)
  - `phi3:mini` (chat generation)

## Install

From this folder (`Chapter-06-RAG/assignment/js`):

```bash
npm install
```

## Setup

1. Start Ollama if it is not already running.
2. Pull the required model:

```bash
ollama pull embeddinggemma
```

3. (Optional) Choose which markdown file to ingest by setting `RAG_SOURCE_DOC`.

PowerShell:

```powershell
$env:RAG_SOURCE_DOC = "faq.md"
```

If not set, the default is `faq.md`.

4. (Optional) Choose chat model for answer generation:

```powershell
$env:RAG_CHAT_MODEL = "phi3:mini"
```

5. (Optional) Force a fresh ingest by deleting the vector store file:

```bash
# PowerShell
Remove-Item ..\vector_store_faq.json -ErrorAction SilentlyContinue
Remove-Item ..\vector_store_products.json -ErrorAction SilentlyContinue
```

## Run

```bash
npm start
```

Open `http://localhost:3000`.

The page includes:
- Products menu backed by a local SQLite catalog that is created automatically if missing
- FAQ page rendered from markdown (`faq.md` by default)
- Smart Search with `Auto`, `Products`, and `FAQ` modes
- Product search results that return a matched product and an add-to-cart link

On first run, `catalog.js` creates `products.sqlite` with five sample products if the database is missing. `rag.js` reads `../docs/<RAG_SOURCE_DOC>` for FAQ content, reads products from SQLite, generates embeddings via Ollama, and saves them to `../vector_store_faq.json` and `../vector_store_products.json`. Subsequent runs load the stores from disk and skip ingestion unless the FAQ file or SQLite database changes.

## Usage as a module

`rag.js` exports three functions you can import in other scripts:

```js
import { ingest, getChunks, search } from "./rag.js";

// Ingest (or load) the FAQ and product vector stores
const stores = await ingest();

// Get all text chunks from the source document
const chunks = getChunks();

// Search for the most relevant FAQ or product match
const result = await search("your question here", stores, "auto");
```

It also exports `answerWithRag(prompt, mode, stores)` which returns an LLM-generated answer grounded in the retrieved FAQ chunk or product record.
