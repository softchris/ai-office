import express from "express";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { answerWithRag, generateAgentGreeting, ingest } from "./rag.js";
import { ensureProductDatabase, getProducts } from "./catalog.js";
import {
	appendConversationMessage,
	ensureAgentDatabase,
	getConversationHistory,
	getUserById,
	verifyUserCredentials,
} from "./agent-memory.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const port = Number(process.env.PORT || 3000);
const sourceDoc = process.env.RAG_FAQ_DOC || process.env.RAG_SOURCE_DOC || "faq.md";
const sourceFile = path.join(__dirname, "..", "docs", sourceDoc);

let stores = null;
const sessionCookieName = "agent_session";
const sessions = new Map();

app.use(express.json());
app.use(express.static(__dirname));

function parseCookies(cookieHeader = "") {
	const cookies = {};
	for (const part of cookieHeader.split(";")) {
		const [key, ...valueParts] = part.trim().split("=");
		if (!key) {
			continue;
		}

		cookies[key] = decodeURIComponent(valueParts.join("="));
	}

	return cookies;
}

async function getAuthenticatedUser(req) {
	const cookies = parseCookies(req.headers.cookie || "");
	const sessionId = cookies[sessionCookieName];
	if (!sessionId) {
		return null;
	}

	const userId = sessions.get(sessionId);
	if (!userId) {
		return null;
	}

	const user = await getUserById(userId);
	if (!user) {
		sessions.delete(sessionId);
		return null;
	}

	return user;
}

function clearSessionCookie(res) {
	res.setHeader(
		"Set-Cookie",
		`${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
	);
}

app.post("/api/auth/login", async (req, res) => {
	try {
		const username = String(req.body?.username || "").trim();
		const password = String(req.body?.password || "").trim();

		if (!username || !password) {
			return res.status(400).json({ error: "'username' and 'password' are required" });
		}

		const user = await verifyUserCredentials(username, password);
		if (!user) {
			return res.status(401).json({ error: "Invalid username or password" });
		}

		const sessionId = randomUUID();
		sessions.set(sessionId, user.id);
		res.setHeader(
			"Set-Cookie",
			`${sessionCookieName}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax`,
		);

		return res.json({
			authenticated: true,
			user: {
				id: user.id,
				username: user.username,
				displayName: user.displayName,
			},
		});
	} catch (error) {
		return res.status(500).json({ error: error?.message || "Login failed" });
	}
});

app.post("/api/auth/logout", async (req, res) => {
	const cookies = parseCookies(req.headers.cookie || "");
	const sessionId = cookies[sessionCookieName];
	if (sessionId) {
		sessions.delete(sessionId);
	}

	clearSessionCookie(res);
	return res.json({ authenticated: false });
});

app.get("/api/auth/me", async (req, res) => {
	try {
		const user = await getAuthenticatedUser(req);
		if (!user) {
			return res.json({ authenticated: false });
		}

		return res.json({
			authenticated: true,
			user: {
				id: user.id,
				username: user.username,
				displayName: user.displayName,
			},
		});
	} catch (error) {
		return res.status(500).json({ error: error?.message || "Could not check auth" });
	}
});

app.get("/api/agent/history", async (req, res) => {
	try {
		const user = await getAuthenticatedUser(req);
		if (!user) {
			return res.status(401).json({ error: "You must be logged in" });
		}

		const messages = await getConversationHistory(user.id, 200);
		return res.json({ messages });
	} catch (error) {
		return res.status(500).json({ error: error?.message || "Could not load history" });
	}
});

app.post("/api/agent/chat", async (req, res) => {
	try {
		const message = String(req.body?.message || "").trim();
		if (!message) {
			return res.status(400).json({ error: "'message' is required" });
		}

		if (!stores) {
			stores = await ingest(sourceFile);
		}

		const user = await getAuthenticatedUser(req);
		const history = user
			? await getConversationHistory(user.id, 20)
			: [];

		const result = await answerWithRag(
			message,
			"auto",
			stores,
			history.map((entry) => ({ role: entry.role, content: entry.content })),
		);

		if (user) {
			await appendConversationMessage(user.id, "user", message);
			await appendConversationMessage(user.id, "assistant", result.answer || "");
		}

		return res.json({
			answer: result.answer,
			product: result.product ?? null,
			context: result.context,
			source: result.source,
			mode: result.mode,
			confidence: result.confidence,
			persisted: Boolean(user),
		});
	} catch (error) {
		return res.status(500).json({ error: error?.message || "Agent chat failed" });
	}
});

app.post("/api/agent/greet", async (req, res) => {
	try {
		const user = await getAuthenticatedUser(req);
		if (!user) {
			return res.status(401).json({ error: "You must be logged in" });
		}

		if (!stores) {
			stores = await ingest(sourceFile);
		}

		const history = await getConversationHistory(user.id, 10);
		const greeting = await generateAgentGreeting(user.displayName, history, stores);
		return res.json(greeting);
	} catch (error) {
		return res.status(500).json({ error: error?.message || "Could not generate greeting" });
	}
});

app.get("/api/faq", (_req, res) => {
	if (!fs.existsSync(sourceFile)) {
		return res.status(404).json({ error: `Source document not found: ${sourceDoc}` });
	}

	const markdown = fs.readFileSync(sourceFile, "utf-8");
	return res.json({ source: sourceDoc, markdown });
});

app.get("/api/products", async (_req, res) => {
	try {
		const products = await getProducts();
		return res.json({ products });
	} catch (error) {
		return res.status(500).json({ error: error?.message || "Could not load products" });
	}
});

app.post("/api/search", async (req, res) => {
	try {
		const query = String(req.body?.query || "").trim();
		const mode = String(req.body?.mode || "auto").toLowerCase();
		if (!query) {
			return res.status(400).json({ error: "'query' is required" });
		}

		if (!["auto", "faq", "product"].includes(mode)) {
			return res.status(400).json({ error: "'mode' must be one of auto, faq, or product" });
		}

		if (!stores) {
			stores = await ingest(sourceFile);
		}

		const result = await answerWithRag(query, mode, stores);
		return res.json(result);
	} catch (error) {
		return res.status(500).json({ error: error?.message || "Search failed" });
	}
});

app.get("*", (_req, res) => {
	res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(port, async () => {
	console.log(`[LOG] E-commerce app listening on http://localhost:${port}`);
	try {
		await ensureProductDatabase();
		await ensureAgentDatabase();
		stores = await ingest(sourceFile);
	} catch (error) {
		console.error(`[LOG] Initial ingest failed: ${error?.message || error}`);
	}
});
