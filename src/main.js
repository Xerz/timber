const grid = document.getElementById("grid");
const statusEl = document.getElementById("status");
const statusText = document.getElementById("statusText");
const statusSub = document.getElementById("statusSub");
const retryBtn = document.getElementById("retryBtn");

let invoke = null;
let listen = null;
let started = false;
let lastLoadPromise = null;
const skipAutoInit = window.__TAURI_TEST_DISABLE_AUTO_INIT === true;

function resolveTauriApi() {
  const tauri = window.__TAURI__ || null;
  return {
    invoke: tauri?.core?.invoke || tauri?.tauri?.invoke || tauri?.invoke || null,
    listen: tauri?.event?.listen || null
  };
}

const fallbackDesktopCard = {
  productId: "desktop",
  title: "Рабочий стол",
  imageUrl: "",
  alt: "Доступ ко всему почти без ограничений.",
  requiredAccount: "",
  isFree: true
};

retryBtn.addEventListener("click", () => {
  if (invoke) {
    loadCards();
  } else {
    window.location.reload();
  }
});

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function render(cards) {
  const header = `
    <h3 class="game-header">Самые популярные игры</h3>
    <div class="row-break"></div>
  `;
  const items = cards.map(card => {
    const title = escapeHtml(card.title || "");
    const alt = escapeHtml(card.alt || "");
    const required = card.requiredAccount ? `<div class=\"gameList__item-badge-required-account\">${escapeHtml(card.requiredAccount)}</div>` : "";
    const free = card.isFree ? `<div class=\"gameList__item-badge-price\">Бесплатная</div>` : "";
    const rawImageUrl = card.imageUrl || "";
    const safeImageUrl = rawImageUrl.replace(/'/g, "%27");
    const imageStyle = rawImageUrl ? ` style=\"background-image: url('${encodeURI(safeImageUrl)}')\"` : "";
    const placeholderClass = rawImageUrl ? "" : "card--placeholder";

    return `
      <div class=\"gameList__item gameList__item-thumb ivu-card ivu-card-bordered ${placeholderClass}\" data-product-id=\"${escapeHtml(card.productId)}\" data-image-url=\"${escapeHtml(rawImageUrl)}\">
        <div class=\"ivu-card-body\">
          <a href=\"#\" class=\"gameList__item-overlay\" title=\"${alt}\">${title}</a>
          <div class=\"gameList__item-image\"${imageStyle}></div>
          <div class=\"gameList__item-title\"><span>${title}</span></div>
          <div class=\"gameList__item-start gameList__item-start_active\">Играть&nbsp;<i class=\"ivu-icon ivu-icon-md-log-in\"></i></div>
          <div class=\"gameList__item-badges\">${required}${free}</div>
        </div>
      </div>
    `;
  }).join("");

  grid.innerHTML = header + items;

  [...grid.querySelectorAll(".gameList__item")].forEach(cardEl => {
    const imageUrl = cardEl.dataset.imageUrl;
    if (imageUrl) {
      preloadImage(cardEl, imageUrl);
    }

    cardEl.addEventListener("click", async (event) => {
      event.preventDefault();
      const productId = cardEl.dataset.productId;
      if (!productId) return;
      if (cardEl.classList.contains("is-launching")) return;
      cardEl.classList.add("is-launching");
      if (!invoke) {
        setStatus("Запуск доступен только в приложении", "", false);
        setTimeout(() => cardEl.classList.remove("is-launching"), 800);
        return;
      }
      try {
        await withTimeout(invoke("launch_game", { productId }), 10_000, "Таймаут запуска");
      } catch (error) {
        cardEl.classList.remove("is-launching");
        setStatus("Ошибка запуска", String(error), false);
      }
    });
  });
}

function setStatus(text, sub = "", showRetry = false) {
  statusText.textContent = text || "";
  statusSub.textContent = sub || "";
  retryBtn.style.display = showRetry ? "inline-flex" : "none";
  statusEl.classList.remove("is-hidden");
}

function clearStatus() {
  statusEl.classList.add("is-hidden");
}

function handleStatusEvent(payload) {
  if (!payload) return;
  const { text, current, total } = payload;
  if (typeof current === "number" && typeof total === "number" && total > 0) {
    setStatus(text || "Загрузка…", `Получено ${current}/${total}`);
    return;
  }
  setStatus(text || "Загрузка…");
}

function loadCards() {
  lastLoadPromise = (async () => {
    setStatus("Загрузка…");
    try {
      const cards = await invoke("load_cards");
      clearStatus();
      render(cards || []);
    } catch (error) {
      setStatus("Ошибка загрузки данных", String(error), true);
      render([fallbackDesktopCard]);
    }
  })();
  return lastLoadPromise;
}

function preloadImage(cardEl, imageUrl) {
  const img = new Image();
  img.onload = () => {
    cardEl.classList.remove("card--placeholder");
  };
  img.onerror = () => {
    const imageEl = cardEl.querySelector(".gameList__item-image");
    if (imageEl) imageEl.style.backgroundImage = "";
    cardEl.classList.add("card--placeholder");
  };
  img.src = imageUrl;
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function initTauri(options = { load: true }) {
  if (started) return true;
  const api = resolveTauriApi();
  if (api.listen && !listen) {
    listen = api.listen;
    listen("status", (event) => handleStatusEvent(event.payload));
  }
  if (api.invoke && !invoke) {
    invoke = api.invoke;
  }
  if (invoke && !started) {
    started = true;
    if (options.load) {
      loadCards();
    }
    return true;
  }
  return false;
}

const params = new URLSearchParams(window.location.search);
const mockMode = params.get("mock") === "1";

if (!skipAutoInit) {
  if (!initTauri()) {
    if (mockMode) {
      fetch("/mock-data.json")
        .then(res => res.json())
        .then(render)
        .catch(() => setStatus("Не удалось загрузить mock-data.json", "", true));
    } else {
      window.addEventListener("DOMContentLoaded", () => {
        if (!started) initTauri();
      });
      setTimeout(() => {
        if (!started) initTauri();
      }, 0);
    }
  }
} else if (mockMode) {
  fetch("/mock-data.json")
    .then(res => res.json())
    .then(render)
    .catch(() => setStatus("Не удалось загрузить mock-data.json", "", true));
}

window.__setCards = render;
window.__setStatus = setStatus;
window.__clearStatus = clearStatus;
window.__resetLauncher = () => {
  invoke = null;
  listen = null;
  started = false;
  if (window.__TAURI_TEST_DISABLE_AUTO_INIT === true) {
    const api = resolveTauriApi();
    if (api.listen) {
      listen = api.listen;
      listen("status", (event) => handleStatusEvent(event.payload));
    }
    if (api.invoke) {
      invoke = api.invoke;
      started = true;
      return loadCards();
    }
    return Promise.resolve();
  }

  initTauri({ load: false });
  if (invoke) {
    return loadCards();
  }
  return Promise.resolve();
};
window.__lastLoadPromise = () => lastLoadPromise;
