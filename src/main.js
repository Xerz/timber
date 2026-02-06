const grid = document.getElementById("grid");
const statusEl = document.getElementById("status");
const statusText = document.getElementById("statusText");
const statusSub = document.getElementById("statusSub");
const retryBtn = document.getElementById("retryBtn");

const tauri = window.__TAURI__ || null;
const invoke = tauri?.core?.invoke || tauri?.tauri?.invoke || tauri?.invoke || null;
const listen = tauri?.event?.listen || null;

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
  grid.innerHTML = cards.map(card => {
    const title = escapeHtml(card.title || "");
    const alt = escapeHtml(card.alt || "");
    const required = card.requiredAccount ? `<div class=\"gameList__item-badge-required-account\">${escapeHtml(card.requiredAccount)}</div>` : "";
    const free = card.isFree ? `<div class=\"gameList__item-badge-price\">Бесплатная</div>` : "";
    const rawImageUrl = card.imageUrl || "";
    const safeImageUrl = rawImageUrl.replace(/'/g, "%27");
    const imageStyle = rawImageUrl ? ` style=\"background-image: url('${encodeURI(safeImageUrl)}')\"` : "";
    const placeholderClass = rawImageUrl ? "" : "card--placeholder";

    return `
      <div class=\"gameList__item ${placeholderClass}\" data-product-id=\"${escapeHtml(card.productId)}\" data-image-url=\"${escapeHtml(rawImageUrl)}\">
        <a href=\"#\" class=\"gameList__item-overlay\" title=\"${alt}\">${title}</a>
        <div class=\"gameList__item-image\"${imageStyle}></div>
        <div class=\"gameList__item-title\"><span>${title}</span></div>
        <div class=\"gameList__item-start gameList__item-start_active\">Играть <i class=\"ivu-icon ivu-icon-md-log-in\"></i></div>
        <div class=\"gameList__item-badges\">${required}${free}</div>
      </div>
    `;
  }).join("");

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

async function loadCards() {
  setStatus("Загрузка…");
  try {
    const cards = await invoke("load_cards");
    clearStatus();
    render(cards || []);
  } catch (error) {
    setStatus("Ошибка загрузки данных", String(error), true);
    render([fallbackDesktopCard]);
  }
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

if (listen) {
  listen("status", (event) => handleStatusEvent(event.payload));
}

if (invoke) {
  loadCards();
} else {
  const params = new URLSearchParams(window.location.search);
  if (params.get("mock") === "1") {
    fetch("/mock-data.json")
      .then(res => res.json())
      .then(render)
      .catch(() => setStatus("Не удалось загрузить mock-data.json", "", true));
  }
}

window.__setCards = render;
window.__setStatus = setStatus;
window.__clearStatus = clearStatus;
