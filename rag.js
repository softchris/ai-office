import { Ollama } from "ollama";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { databasePath, getProducts } from "./catalog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const embeddingModel = process.env.RAG_EMBEDDING_MODEL || "embeddinggemma";
const chatModel = process.env.RAG_CHAT_MODEL || "phi3:mini";
const faqVectorStorePath = path.join(__dirname, "..", "vector_store_faq.json");
const productVectorStorePath = path.join(__dirname, "..", "vector_store_products.json");
const threshold = 0.3;
const chunkingVersion = 1;
const faqSourceDoc = process.env.RAG_FAQ_DOC || process.env.RAG_SOURCE_DOC || "faq.md";
const defaultSourceFile = path.join(__dirname, "..", "docs", faqSourceDoc);

const ollama = new Ollama();

function log(msg) {
  console.log(`[LOG] ${msg}`);
}

function readStoreFromDisk(storePath) {
  if (!fs.existsSync(storePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(storePath, "utf-8"));
}

function getStoreFirstEntry(store) {
  return Object.values(store || {})[0] || null;
}

function saveStore(storePath, store) {
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
}

function findBestMatch(queryVector, store) {
  let bestScore = -Infinity;
  let bestEntry = null;

  for (const entry of Object.values(store)) {
    const score = cosineSimilarity(queryVector, entry.vector);
    if (score > bestScore) {
      bestScore = score;
      bestEntry = entry;
    }
  }

  return { bestEntry, bestScore };
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function getEmbedding(text) {
  const response = await ollama.embed({ model: embeddingModel, input: text });
  return response.embeddings[0];
}

function productToDocument(product) {
  return [
    `# ${product.name}`,
    "",
    `Product ID: ${product.id}`,
    `Price: ${product.price}`,
    "",
    "## Description",
    product.description,
  ].join("\n");
}

function buildProductPayload(metadata) {
  if (!metadata?.product_id) {
    return null;
  }

  return {
    id: metadata.product_id,
    name: metadata.product_name,
    price: metadata.price,
    description: metadata.product_description,
    addToCartUrl: `/?add-to-cart=${metadata.product_id}`,
  };
}

function normalizeMatch(mode, bestEntry, bestScore) {
  if (!bestEntry) {
    return {
      mode,
      content: null,
      chunkIndex: -1,
      similarity: null,
      confidence: "none",
      source: null,
      product: null,
    };
  }

  const chunkIndex = bestEntry.metadata?.chunk_index ?? -1;
  return {
    mode,
    content: bestEntry.text,
    chunkIndex,
    similarity: bestScore,
    confidence: bestScore < threshold ? "low" : "high",
    source: {
      type: bestEntry.metadata?.source_type || mode,
      fileName: bestEntry.metadata?.file_name || null,
      path: bestEntry.metadata?.source || null,
    },
    product: mode === "product" ? buildProductPayload(bestEntry.metadata) : null,
  };
}

function selectMode(requestedMode, faqResult, productResult) {
  if (requestedMode === "faq") {
    return faqResult;
  }

  if (requestedMode === "product") {
    return productResult;
  }

  if (!faqResult.content && !productResult.content) {
    return productResult.similarity > faqResult.similarity ? productResult : faqResult;
  }

  if (!faqResult.content) {
    return productResult;
  }

  if (!productResult.content) {
    return faqResult;
  }

  return productResult.similarity > faqResult.similarity ? productResult : faqResult;
}

function createNoMatchAnswer(mode) {
  if (mode === "product") {
    return "I could not find a product that matches that request.";
  }

  if (mode === "faq") {
    return "I could not find a relevant answer in the FAQ.";
  }

  return "I could not find a relevant product or FAQ answer for that request.";
}

function isFreshStore(store, metadata) {
  const firstEntry = getStoreFirstEntry(store);
  if (!firstEntry?.metadata) {
    return false;
  }

  return (
    firstEntry.metadata.source === metadata.source &&
    firstEntry.metadata.source_type === metadata.source_type &&
    firstEntry.metadata.chunking_version === metadata.chunking_version &&
    firstEntry.metadata.source_mtime === metadata.source_mtime
  );
}

function splitMarkdown(text, chunkSize = 500) {
  const paragraphs = text.split(/\r?\n\r?\n+/);
  const chunks = [];
  let current = "";

  for (const para of paragraphs) {
    if (current && (current + "\n\n" + para).length > chunkSize) {
      chunks.push(current.trim());
      current = para;
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export async function ingestFaq(sourceFile = defaultSourceFile) {
  const sourceStats = fs.statSync(sourceFile);
  const metadataMarker = {
    source: sourceFile,
    source_type: "faq",
    chunking_version: chunkingVersion,
    source_mtime: sourceStats.mtimeMs,
  };

  const loadedStore = readStoreFromDisk(faqVectorStorePath);
  if (loadedStore && isFreshStore(loadedStore, metadataMarker)) {
    log(`Loading FAQ vector store from ${faqVectorStorePath}...`);
    return loadedStore;
  }

  log("Creating new FAQ vector store...");
  const text = fs.readFileSync(sourceFile, "utf-8");
  const chunks = splitMarkdown(text, 500);
  log(`Split FAQ into ${chunks.length} chunks`);

  const store = {};
  log("Adding FAQ chunks to the vector store...");
  for (let i = 0; i < chunks.length; i++) {
    const vector = await getEmbedding(chunks[i]);
    const id = randomUUID();
    store[id] = {
      id,
      vector,
      text: chunks[i],
      metadata: {
        ...metadataMarker,
        file_name: path.basename(sourceFile),
        chunk_index: i,
      },
    };
  }

  log(`Saving FAQ vector store to ${faqVectorStorePath}...`);
  saveStore(faqVectorStorePath, store);
  return store;
}

export async function ingestProducts() {
  const dbStats = fs.statSync(databasePath);
  const metadataMarker = {
    source: databasePath,
    source_type: "product",
    chunking_version: chunkingVersion,
    source_mtime: dbStats.mtimeMs,
  };

  const loadedStore = readStoreFromDisk(productVectorStorePath);
  if (loadedStore && isFreshStore(loadedStore, metadataMarker)) {
    log(`Loading product vector store from ${productVectorStorePath}...`);
    return loadedStore;
  }

  log("Creating new product vector store...");
  const products = await getProducts();
  const store = {};

  for (const product of products) {
    const text = productToDocument(product);
    const vector = await getEmbedding(text);
    const id = randomUUID();
    store[id] = {
      id,
      vector,
      text,
      metadata: {
        ...metadataMarker,
        file_name: path.basename(databasePath),
        chunk_index: 0,
        product_id: product.id,
        product_name: product.name,
        price: product.price,
        product_description: product.description,
      },
    };
  }

  log(`Saving product vector store to ${productVectorStorePath}...`);
  saveStore(productVectorStorePath, store);
  return store;
}

export async function ingest(sourceFile = defaultSourceFile) {
  const [faqStore, productStore] = await Promise.all([
    ingestFaq(sourceFile),
    ingestProducts(),
  ]);

  return { faqStore, productStore };
}

export function getChunks(sourceFile = defaultSourceFile) {
  const text = fs.readFileSync(sourceFile, "utf-8");
  return splitMarkdown(text, 500);
}

function searchStore(queryVector, store, mode) {
  const { bestEntry, bestScore } = findBestMatch(queryVector, store);
  return normalizeMatch(mode, bestEntry, bestScore);
}

export async function search(prompt, stores = null, mode = "auto") {
  const effectiveStores = stores ?? (await ingest());
  const queryVector = await getEmbedding(prompt);
  const faqResult = searchStore(queryVector, effectiveStores.faqStore, "faq");
  const productResult = searchStore(queryVector, effectiveStores.productStore, "product");
  const selected = selectMode(mode, faqResult, productResult);

  if (!selected.content) {
    log("No results found");
    return selected;
  }

  log(`Query: ${prompt}`);
  log(`Selected ${selected.mode} result with similarity ${selected.similarity?.toFixed(4) ?? "n/a"}`);
  return selected;
}

export async function answerWithRag(prompt, mode = "auto", stores = null, chatHistory = []) {
  const retrieval = await search(prompt, stores, mode);

  if (!retrieval.content) {
    return {
      answer: createNoMatchAnswer(mode),
      chunkIndex: -1,
      context: null,
      similarity: null,
      confidence: "none",
      mode,
      source: null,
      product: null,
    };
  }

  const lowConfidence = retrieval.confidence === "low";
  const systemMessage = retrieval.mode === "product"
    ? [
        "You are an e-commerce product assistant.",
        "Use only the retrieved product data below.",
        "Recommend the product only if it fits the user's request.",
        "Mention the product name and price. Do not write or invent any URLs — a clickable Add to cart link will appear automatically below your reply.",
        lowConfidence ? "The retrieved product match has low semantic confidence, so mention uncertainty if needed." : "",
        "",
        "Product context:",
        retrieval.content,
      ].join("\n")
    : [
        "You are an e-commerce support assistant.",
        "Answer the user's question using only the FAQ context below.",
        "If the context is incomplete, say that clearly and stay concise.",
        lowConfidence ? "The retrieved FAQ context has low semantic confidence, so mention uncertainty if needed." : "",
        "",
        "FAQ context:",
        retrieval.content,
      ].join("\n");

  const normalizedHistory = Array.isArray(chatHistory)
    ? chatHistory
      .filter((entry) => ["user", "assistant"].includes(String(entry?.role || "")))
      .map((entry) => ({
        role: String(entry.role),
        content: String(entry.content || "").trim(),
      }))
      .filter((entry) => entry.content)
      .slice(-20)
    : [];

  const response = await ollama.chat({
    model: chatModel,
    messages: [
      { role: "system", content: systemMessage },
      ...normalizedHistory,
      { role: "user", content: prompt },
    ],
  });

  return {
    answer: response?.message?.content?.trim() || "I could not generate an answer.",
    chunkIndex: retrieval.chunkIndex,
    context: retrieval.content,
    similarity: retrieval.similarity,
    confidence: retrieval.confidence,
    mode: retrieval.mode,
    source: retrieval.source,
    product: retrieval.product,
  };
}

export async function generateAgentGreeting(displayName, chatHistory = [], stores = null) {
  const effectiveStores = stores ?? (await ingest());

  const recentUserMessages = chatHistory
    .filter((m) => m.role === "user")
    .slice(-5)
    .map((m) => `- ${m.content}`)
    .join("\n");

  const systemMessage = recentUserMessages
    ? [
        "You are a warm, friendly e-commerce shopping assistant.",
        `The user's name is ${displayName} and they just logged back in.`,
        `Their recent questions were:\n${recentUserMessages}`,
        "",
        "Greet them by name, briefly mention what they were looking at before, and say you remember their preferences.",
        "Keep it to 2-3 sentences. Be warm but concise. Do not write or invent any URLs.",
      ].join("\n")
    : [
        "You are a warm, friendly e-commerce shopping assistant.",
        `The user's name is ${displayName}. Greet them warmly by name.`,
        "Invite them to ask about products, check the FAQ, or use smart search.",
        "Keep it to 1-2 sentences.",
      ].join("\n");

  const response = await ollama.chat({
    model: chatModel,
    messages: [
      { role: "system", content: systemMessage },
      { role: "user", content: "Hi, I just logged in." },
    ],
  });

  const answer =
    response?.message?.content?.trim() ||
    `Welcome back, ${displayName}! How can I help you today?`;

  // Try to find a relevant product based on previous user messages.
  let product = null;
  if (recentUserMessages) {
    try {
      const queryVector = await getEmbedding(recentUserMessages);
      const { bestEntry, bestScore } = findBestMatch(queryVector, effectiveStores.productStore);
      if (bestEntry && bestScore >= threshold && bestEntry.metadata?.product_id) {
        product = buildProductPayload(bestEntry.metadata);
      }
    } catch {
      // Product suggestion is best-effort; ignore failures.
    }
  }

  return { answer, product };
}

// Main
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const store = await ingest();
  const prompt = "What is your return policy?";
  const result = await answerWithRag(prompt, "faq", store);
  console.log(`Chunk: ${result.chunkIndex}`);
  console.log(result.answer);
}
