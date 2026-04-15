const cartStorageKey = "acme-cart";
const state = {
  products: [],
  cart: loadCart(),
  agent: {
    authenticated: false,
    user: null,
    messages: [],
  },
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function loadCart() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(cartStorageKey) || "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }

    if (parsed.every((item) => Number.isFinite(Number(item)))) {
      const quantities = new Map();
      for (const productId of parsed) {
        const key = Number(productId);
        quantities.set(key, (quantities.get(key) || 0) + 1);
      }

      return Array.from(quantities, ([productId, quantity]) => ({ productId, quantity }));
    }

    return parsed
      .map((item) => ({
        productId: Number(item?.productId),
        quantity: Number(item?.quantity || 0),
      }))
      .filter((item) => Number.isFinite(item.productId) && item.quantity > 0);
  } catch {
    return [];
  }
}

function saveCart() {
  window.localStorage.setItem(cartStorageKey, JSON.stringify(state.cart));
}

function updateCartCount() {
  const cartCount = document.getElementById("cart-count");
  const totalItems = state.cart.reduce((sum, item) => sum + item.quantity, 0);
  if (cartCount) {
    cartCount.textContent = String(totalItems);
  }
}

function getProductById(productId) {
  return state.products.find((product) => Number(product.id) === Number(productId)) || null;
}

function getCartEntries() {
  return state.cart
    .map((item) => {
      const product = getProductById(item.productId);
      if (!product) {
        return null;
      }

      return {
        ...item,
        product,
      };
    })
    .filter(Boolean);
}

function renderCart() {
  const cartItems = document.getElementById("cart-items");
  const cartSummary = document.getElementById("cart-summary");
  const cartEmpty = document.getElementById("cart-empty");
  if (!cartItems || !cartSummary || !cartEmpty) {
    return;
  }

  const entries = getCartEntries();
  const totalItems = entries.reduce((sum, entry) => sum + entry.quantity, 0);

  if (!entries.length) {
    cartItems.innerHTML = "";
    cartSummary.textContent = "0 items in cart";
    cartEmpty.hidden = false;
    return;
  }

  cartEmpty.hidden = true;
  cartSummary.textContent = `${totalItems} item${totalItems === 1 ? "" : "s"} in cart`;
  cartItems.innerHTML = entries
    .map(
      ({ product, quantity }) => `
        <article class="cart-item" data-cart-product="${product.id}">
          <div>
            <h4>${product.name}</h4>
            <p>${product.description}</p>
            <div class="price">${product.price}</div>
          </div>
          <div class="cart-controls">
            <div class="qty-controls" aria-label="Quantity controls for ${product.name}">
              <button type="button" class="qty-button" data-cart-action="decrease" data-product-id="${product.id}">-</button>
              <span>${quantity}</span>
              <button type="button" class="qty-button" data-cart-action="increase" data-product-id="${product.id}">+</button>
            </div>
            <button type="button" class="remove-button" data-cart-action="remove" data-product-id="${product.id}">Remove</button>
          </div>
        </article>
      `,
    )
    .join("");
}

function openCart() {
  const cartDrawer = document.getElementById("cart-drawer");
  if (!cartDrawer) {
    return;
  }

  cartDrawer.hidden = false;
  document.body.classList.add("cart-open");
}

function closeCart() {
  const cartDrawer = document.getElementById("cart-drawer");
  if (!cartDrawer) {
    return;
  }

  cartDrawer.hidden = true;
  document.body.classList.remove("cart-open");
}

function bumpCartIcon() {
  const cartButton = document.getElementById("cart-button");
  if (!cartButton) {
    return;
  }

  cartButton.classList.remove("cart-bump");
  window.requestAnimationFrame(() => {
    cartButton.classList.add("cart-bump");
  });
}

function animateAddToCart(sourceElement) {
  const cartButton = document.getElementById("cart-button");
  if (!sourceElement || !cartButton) {
    bumpCartIcon();
    return;
  }

  const sourceRect = sourceElement.getBoundingClientRect();
  const cartRect = cartButton.getBoundingClientRect();
  const flyer = document.createElement("div");
  flyer.className = "cart-flyer";
  flyer.style.left = `${sourceRect.left + sourceRect.width / 2}px`;
  flyer.style.top = `${sourceRect.top + sourceRect.height / 2}px`;
  flyer.style.setProperty("--cart-dx", `${cartRect.left + cartRect.width / 2 - (sourceRect.left + sourceRect.width / 2)}px`);
  flyer.style.setProperty("--cart-dy", `${cartRect.top + cartRect.height / 2 - (sourceRect.top + sourceRect.height / 2)}px`);
  document.body.appendChild(flyer);

  flyer.addEventListener("animationend", () => {
    flyer.remove();
    bumpCartIcon();
  }, { once: true });
}

function addToCart(productId, sourceElement = null) {
  const product = getProductById(productId);
  if (!product) {
    return false;
  }

  const existing = state.cart.find((item) => Number(item.productId) === Number(product.id));
  if (existing) {
    existing.quantity += 1;
  } else {
    state.cart.push({ productId: product.id, quantity: 1 });
  }

  saveCart();
  updateCartCount();
  renderCart();
  animateAddToCart(sourceElement);
  return true;
}

function changeCartQuantity(productId, delta) {
  const entry = state.cart.find((item) => Number(item.productId) === Number(productId));
  if (!entry) {
    return;
  }

  entry.quantity += delta;
  state.cart = state.cart.filter((item) => item.quantity > 0);
  saveCart();
  updateCartCount();
  renderCart();
}

function removeFromCart(productId) {
  state.cart = state.cart.filter((item) => Number(item.productId) !== Number(productId));
  saveCart();
  updateCartCount();
  renderCart();
}

function clearCart() {
  state.cart = [];
  saveCart();
  updateCartCount();
  renderCart();
}

function setupMenu() {
  const buttons = document.querySelectorAll(".menu button");
  const panels = document.querySelectorAll(".panel");

  for (const button of buttons) {
    button.addEventListener("click", () => {
      const panelId = button.dataset.panel;
      for (const b of buttons) b.classList.remove("active");
      for (const panel of panels) panel.classList.remove("active");
      button.classList.add("active");
      document.getElementById(panelId)?.classList.add("active");
    });
  }
}

function renderProducts() {
  const grid = document.getElementById("products-grid");
  if (!grid) return;

  grid.innerHTML = state.products
    .map(
      (p) => `
      <article class="product">
        <h4>${p.name}</h4>
        <p>${p.description}</p>
        <div class="price">${p.price}</div>
        <a class="action-link" href="/?add-to-cart=${p.id}" data-add-to-cart="${p.id}">Add to cart</a>
      </article>
    `,
    )
    .join("");
}

async function loadProducts() {
  const grid = document.getElementById("products-grid");

  try {
    const res = await fetch("/api/products");
    if (!res.ok) throw new Error("Failed to load products");

    const data = await res.json();
    state.products = data.products || [];
    renderProducts();
    renderCart();
    handleAddToCartFromUrl();
  } catch (error) {
    if (grid) {
      grid.innerHTML = `<p>Could not load products: ${error.message}</p>`;
    }
  }
}

async function loadFaq() {
  const faqSource = document.getElementById("faq-source");
  const faqContent = document.getElementById("faq-content");

  try {
    const res = await fetch("/api/faq");
    if (!res.ok) throw new Error("Failed to load FAQ");

    const data = await res.json();
    faqSource.textContent = data.source;
    faqContent.innerHTML = window.marked.parse(data.markdown || "");
  } catch (error) {
    faqSource.textContent = "unavailable";
    faqContent.textContent = `Could not load FAQ: ${error.message}`;
  }
}

function setupSearch() {
  const form = document.getElementById("search-form");
  const input = document.getElementById("search-input");
  const mode = document.getElementById("search-mode");
  const status = document.getElementById("search-status");
  const answer = document.getElementById("search-answer");
  const context = document.getElementById("search-context");
  const source = document.getElementById("search-source");
  const productCard = document.getElementById("search-product");

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = input.value.trim();
    if (!query) return;

    status.textContent = "Searching and generating answer...";
    answer.textContent = "";
    context.textContent = "";
    source.textContent = "";
    productCard.hidden = true;

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, mode: mode?.value || "auto" }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Search failed");
      }

      answer.textContent = data.answer || "No answer generated.";
      context.textContent = data.context || "No relevant FAQ chunk found.";
      source.textContent = data.source?.fileName ? `${data.mode.toUpperCase()} source: ${data.source.fileName}` : "";

      if (data.product) {
        productCard.hidden = false;
        productCard.innerHTML = `
          <h4>${data.product.name}</h4>
          <p>${data.product.description}</p>
          <div class="price">${data.product.price}</div>
          <a class="action-link" href="${data.product.addToCartUrl}" data-add-to-cart="${data.product.id}">Add to cart</a>
        `;
      }

      if (data.mode === "product") {
        status.textContent = data.product
          ? `Matched product #${data.product.id} (${data.confidence} confidence)`
          : "No matching product found";
      } else {
        status.textContent = data.chunkIndex >= 0
          ? `Matched FAQ chunk #${data.chunkIndex} (${data.confidence} confidence)`
          : "No relevant FAQ chunk matched";
      }
    } catch (error) {
      status.textContent = "Request failed";
      answer.textContent = error.message;
      context.textContent = "";
      source.textContent = "";
      productCard.hidden = true;
    }
  });
}

function handleAddToCartFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const productId = params.get("add-to-cart");
  if (!productId) {
    return;
  }

  addToCart(productId);
  params.delete("add-to-cart");
  const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
  window.history.replaceState({}, "", nextUrl);
}

function setupCartActions() {
  document.addEventListener("click", (event) => {
    const link = event.target.closest("[data-add-to-cart]");
    if (link) {
      event.preventDefault();
      const productId = link.getAttribute("data-add-to-cart");
      if (!productId) {
        return;
      }

      addToCart(productId, link);
      return;
    }

    const cartAction = event.target.closest("[data-cart-action]");
    if (cartAction) {
      const action = cartAction.getAttribute("data-cart-action");
      const productId = cartAction.getAttribute("data-product-id");
      if (!productId) {
        return;
      }

      if (action === "increase") {
        changeCartQuantity(productId, 1);
      } else if (action === "decrease") {
        changeCartQuantity(productId, -1);
      } else if (action === "remove") {
        removeFromCart(productId);
      } else if (action === "clear") {
        clearCart();
      }
      return;
    }

    if (event.target.closest("[data-open-cart]")) {
      openCart();
      return;
    }

    if (event.target.closest("[data-close-cart]")) {
      closeCart();
    }
  });
}

function setupCartDrawer() {
  renderCart();
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeCart();
    }
  });
}

function renderProductCard(product) {
  if (!product) return "";
  return `
    <div class="agent-product-card">
      <div class="agent-product-name">${escapeHtml(product.name)}</div>
      <div class="agent-product-price">${escapeHtml(String(product.price))}</div>
      <p class="agent-product-desc">${escapeHtml(product.description)}</p>
      <a class="action-link" href="${escapeHtml(product.addToCartUrl)}" data-add-to-cart="${escapeHtml(String(product.id))}">Add to cart</a>
    </div>
  `;
}

function renderAgentMessages() {
  const messagesEl = document.getElementById("agent-messages");
  if (!messagesEl) {
    return;
  }

  if (!state.agent.messages.length) {
    messagesEl.innerHTML = '<p class="agent-empty">No messages yet. Start by asking about products, preferences, or past choices.</p>';
    return;
  }

  messagesEl.innerHTML = state.agent.messages
    .map(
      (message) => `
      <article class="agent-message ${message.role === "user" ? "user" : "assistant"}">
        <span class="agent-role">${message.role === "user" ? "You" : "Agent"}</span>
        <div class="agent-text">${escapeHtml(message.content)}</div>
        ${message.product ? renderProductCard(message.product) : ""}
      </article>
    `,
    )
    .join("");

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setAgentStatus(message, isError = false) {
  const statusEl = document.getElementById("agent-auth-status");
  if (!statusEl) {
    return;
  }

  statusEl.textContent = message;
  statusEl.classList.toggle("error", Boolean(isError));
}

function renderAgentAuthState() {
  const loginView = document.getElementById("agent-login-view");
  const chatView = document.getElementById("agent-chat-view");
  const userLabel = document.getElementById("agent-user-label");

  if (!loginView || !chatView || !userLabel) {
    return;
  }

  if (state.agent.authenticated && state.agent.user) {
    loginView.hidden = true;
    chatView.hidden = false;
    userLabel.textContent = `Logged in as ${state.agent.user.displayName}`;
    setAgentStatus("Conversation memory is loaded from your account.");
  } else {
    loginView.hidden = false;
    chatView.hidden = true;
    userLabel.textContent = "";
    setAgentStatus("Not logged in. Agent memory lasts only for this page session.");
  }

  renderAgentMessages();
}

async function loadAgentHistory() {
  if (!state.agent.authenticated) {
    return;
  }

  const res = await fetch("/api/agent/history");
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Could not load history");
  }

  state.agent.messages = (data.messages || []).map((entry) => ({
    role: entry.role === "user" ? "user" : "assistant",
    content: String(entry.content || ""),
  }));
}

async function checkAgentAuth() {
  try {
    const res = await fetch("/api/auth/me");
    const data = await res.json();

    if (res.ok && data.authenticated && data.user) {
      state.agent.authenticated = true;
      state.agent.user = data.user;
      await loadAgentHistory();
    } else {
      state.agent.authenticated = false;
      state.agent.user = null;
      state.agent.messages = [];
    }
  } catch {
    state.agent.authenticated = false;
    state.agent.user = null;
    state.agent.messages = [];
  }

  renderAgentAuthState();
}

async function sendAgentMessage(message) {
  const trimmedMessage = String(message || "").trim();
  if (!trimmedMessage) {
    return;
  }

  state.agent.messages.push({ role: "user", content: trimmedMessage });
  renderAgentMessages();
  setAgentStatus(state.agent.authenticated ? "Thinking with your memory..." : "Thinking...");

  try {
    const res = await fetch("/api/agent/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: trimmedMessage }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Agent request failed");
    }

    state.agent.messages.push({
      role: "assistant",
      content: data.answer || "I could not generate an answer.",
      product: data.product ?? null,
    });
    renderAgentMessages();

    if (state.agent.authenticated) {
      setAgentStatus("Saved to account memory.");
    } else {
      setAgentStatus("Not logged in. This conversation stays only in the current page session.");
    }
  } catch (error) {
    state.agent.messages.push({ role: "assistant", content: `Error: ${error.message}` });
    renderAgentMessages();
    setAgentStatus(error.message, true);
  }
}

async function callAgentGreet() {
  try {
    const res = await fetch("/api/agent/greet", { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Greeting failed");
    }

    state.agent.messages.push({
      role: "assistant",
      content: data.answer || `Welcome, ${state.agent.user?.displayName}! How can I help you today?`,
      product: data.product ?? null,
    });
    renderAgentMessages();
    setAgentStatus("");
  } catch {
    state.agent.messages.push({
      role: "assistant",
      content: `Welcome back, ${state.agent.user?.displayName || ""}! How can I help you today?`,
    });
    renderAgentMessages();
    setAgentStatus("");
  }
}

function setupAgentUi() {
  const loginForm = document.getElementById("agent-login-form");
  const usernameInput = document.getElementById("agent-username");
  const passwordInput = document.getElementById("agent-password");
  const chatForm = document.getElementById("agent-chat-form");
  const chatInput = document.getElementById("agent-chat-input");
  const logoutButton = document.getElementById("agent-logout");

  loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = String(usernameInput?.value || "").trim();
    const password = String(passwordInput?.value || "").trim();

    if (!username || !password) {
      setAgentStatus("Enter both username and password.", true);
      return;
    }

    setAgentStatus("Logging in...");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Login failed");
      }

      state.agent.authenticated = true;
      state.agent.user = data.user;
      await loadAgentHistory();
      renderAgentAuthState();
      setAgentStatus("Generating your personalised greeting...");
      await callAgentGreet();
      if (chatInput) {
        chatInput.focus();
      }
    } catch (error) {
      state.agent.authenticated = false;
      state.agent.user = null;
      state.agent.messages = [];
      renderAgentAuthState();
      setAgentStatus(error.message, true);
    }
  });

  logoutButton?.addEventListener("click", async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Ignore network failures and still clear local state.
    }

    state.agent.authenticated = false;
    state.agent.user = null;
    state.agent.messages = [];
    renderAgentAuthState();
    setAgentStatus("Logged out. Memory is now session-only.");
  });

  chatForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = String(chatInput?.value || "").trim();
    if (!message) {
      return;
    }

    if (chatInput) {
      chatInput.value = "";
      chatInput.focus();
    }

    await sendAgentMessage(message);
  });
}

setupMenu();
updateCartCount();
setupCartActions();
setupCartDrawer();
loadFaq();
loadProducts();
setupSearch();
setupAgentUi();
checkAgentAuth();
