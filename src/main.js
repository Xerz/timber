const grid = document.getElementById("grid");
const statusEl = document.getElementById("status");
const statusText = document.getElementById("statusText");
const statusSub = document.getElementById("statusSub");
const retryBtn = document.getElementById("retryBtn");

let invoke = null;
let listen = null;
let started = false;
let lastLoadPromise = null;
let loadingActive = false;
let progressLabel = "";
let serverName = "";
let serverDescription = "";
let serverHardware = null;
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

const loadingCard = {
  productId: "loading",
  title: "Загрузка",
  imageUrl: "",
  alt: "Загрузка",
  requiredAccount: "",
  isFree: false,
  isLoading: true,
  startLabel: "Загрузка"
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

function formatServerTitle(name) {
  const trimmed = String(name || "").trim();
  return `Добро пожаловать на сервер: ${trimmed || "…"}`;
}

function formatBytesToGb(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) return "";
  const gb = bytes / (1024 ** 3);
  const rounded = Math.round(gb);
  return `${rounded}GB`;
}

function renderServerDescription() {
  const description = String(serverDescription || "").trim();
  if (!description) {
    return "<div class=\"server-details__empty\">Описание не указано.</div>";
  }
  return description;
}

function renderHardware(hardware) {
  if (!hardware) return "";
  const ramText = formatBytesToGb(hardware.ram_bytes) || "—";
  const cpuText = String(hardware?.processor?.version || "").trim() || "—";
  const gpu = Array.isArray(hardware.graphic) ? hardware.graphic[0] : null;
  const gpuName = String(gpu?.name || "").trim() || "—";
  const gpuRamText = formatBytesToGb(gpu?.ram_bytes);
  const gpuRamSpan = gpuRamText ? ` <span>${escapeHtml(` / ${gpuRamText}`)}</span>` : "";

  return `
    <div class="account-column stationDetails__row stationDetails__row_hardware">
      <div class="stationDetails__wrapper">
        <div class="stationDetails__item ivu-row">
          <div class="stationDetails__item-header">Hardware</div>
        </div>
        <span class="stationDetails__item">
          <div class="stationDetails__item-label ivu-row">Видеокарта:</div>
          <div class="stationDetails__item-content ivu-row">${escapeHtml(gpuName)}${gpuRamSpan}</div>
        </span>
        <span class="stationDetails__item">
          <div class="stationDetails__item-label ivu-row">Оперативная память:</div>
          <div class="stationDetails__item-content ivu-row">${escapeHtml(ramText)}</div>
        </span>
        <span class="stationDetails__item">
          <div class="stationDetails__item-label ivu-row">Процессор:</div>
          <div class="stationDetails__item-content ivu-row">${escapeHtml(cpuText)}</div>
        </span>
      </div>
    </div>
  `;
}

function renderServerDetails() {
  return `
    <details class="server-details">
      <summary class="server-details__summary">Показать описание сервера и контакты</summary>
      <div class="server-details__body" id="serverDescription">${renderServerDescription()}</div>
    </details>
    <div id="serverHardware">${renderHardware(serverHardware)}</div>
  `;
}

function setStationDetails(details = {}) {
  serverName = String(details.name || "").trim();
  serverDescription = String(details.description || "");
  serverHardware = details.hardware || null;
  const el = document.getElementById("serverTitleText");
  if (el) {
    el.textContent = formatServerTitle(serverName);
  }
  const descriptionEl = document.getElementById("serverDescription");
  if (descriptionEl) {
    descriptionEl.innerHTML = renderServerDescription();
  }
  const hardwareEl = document.getElementById("serverHardware");
  if (hardwareEl) {
    hardwareEl.innerHTML = renderHardware(serverHardware);
  }
}

function render(cards) {
  const header = `
    <div class="page-header">
      <h1 class="page__title"><span id="serverTitleText">${escapeHtml(formatServerTitle(serverName))}</span><span id="progressText">${escapeHtml(progressLabel)}</span></h1>
      ${renderServerDetails()}
    </div>
    <div class="row-break"></div>
  `;
  const items = cards.map(card => {
    const title = escapeHtml(card.title || "");
    const alt = escapeHtml(card.alt || "");
    const required = card.requiredAccount ? `<div class=\"gameList__item-badge-required-account\">${escapeHtml(card.requiredAccount)}</div>` : "";
    const free = card.isFree ? `<div class=\"gameList__item-badge-price\">Бесплатная</div>` : "";
    const startLabel = escapeHtml(card.startLabel || "Играть");
    const startIcon = card.isLoading ? "" : "<i class=\\\"ivu-icon ivu-icon-md-log-in\\\"></i>";
    const startContent = startIcon ? `${startLabel}&nbsp;${startIcon}` : startLabel;
    const rawImageUrl = card.imageUrl || "";
    const safeImageUrl = rawImageUrl.replace(/'/g, "%27");
    const imageStyle = rawImageUrl ? ` style=\"background-image: url('${encodeURI(safeImageUrl)}')\"` : "";
    const placeholderClass = rawImageUrl ? "" : "card--placeholder";
    const loadingClass = card.isLoading ? "is-loading" : "";
    const loadingAttr = card.isLoading ? " data-loading=\"1\"" : "";

    return `
      <div class=\"gameList__item gameList__item-thumb ivu-card ivu-card-bordered ${placeholderClass} ${loadingClass}\" data-product-id=\"${escapeHtml(card.productId)}\" data-image-url=\"${escapeHtml(rawImageUrl)}\"${loadingAttr}>
        <div class=\"ivu-card-body\">
          <a href=\"#\" class=\"gameList__item-overlay\" title=\"${alt}\">${title}</a>
          <div class=\"gameList__item-image\"${imageStyle}></div>
          <div class=\"gameList__item-title\"><span>${title}</span></div>
          <div class=\"gameList__item-start gameList__item-start_active\">${startContent}</div>
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
      if (cardEl.dataset.loading === "1") return;
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

function renderLoading(count = 6) {
  const cards = Array.from({ length: count }, (_, index) => ({
    ...loadingCard,
    productId: `loading-${index + 1}`
  }));
  render(cards);
}

function setProgressLabel(label) {
  progressLabel = label || "";
  const el = document.getElementById("progressText");
  if (el) {
    el.textContent = progressLabel;
  }
}

async function loadStationDetails() {
  if (!invoke) return;
  try {
    const details = await invoke("load_station_details");
    setStationDetails(details);
  } catch (error) {
    // Ignore station details errors to keep the launcher usable.
  }
}

function formatProgressLabel(payload) {
  const text = payload.text || "Загрузка…";
  if (typeof payload.current === "number" && typeof payload.total === "number" && payload.total > 0) {
    return ` — ${text} ${payload.current}/${payload.total}`;
  }
  return ` — ${text}`;
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
  if (loadingActive) {
    setProgressLabel(formatProgressLabel(payload));
    return;
  }
  const { text, current, total } = payload;
  if (typeof current === "number" && typeof total === "number" && total > 0) {
    setStatus(text || "Загрузка…", `Получено ${current}/${total}`);
    return;
  }
  setStatus(text || "Загрузка…");
}

function loadCards() {
  lastLoadPromise = (async () => {
    loadStationDetails();
    loadingActive = true;
    clearStatus();
    setProgressLabel(" — Загрузка…");
    renderLoading();
    try {
      const cards = await invoke("load_cards");
      loadingActive = false;
      clearStatus();
      setProgressLabel("");
      render(cards || []);
    } catch (error) {
      loadingActive = false;
      setStatus("Ошибка загрузки данных", String(error), true);
      setProgressLabel("");
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
      setProgressLabel(" — Загрузка…");
      renderLoading();
      fetch("/mock-data.json")
        .then(res => res.json())
        .then(cards => {
          setProgressLabel("");
          render(cards);
        })
        .catch(() => {
          setProgressLabel("");
          setStatus("Не удалось загрузить mock-data.json", "", true);
        });
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
  setProgressLabel(" — Загрузка…");
  fetch("/mock-data.json")
    .then(res => res.json())
    .then(cards => {
      setProgressLabel("");
      render(cards);
    })
    .catch(() => {
      setProgressLabel("");
      setStatus("Не удалось загрузить mock-data.json", "", true);
    });
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
